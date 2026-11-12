import type {
  BugDuplicateCandidate,
  BugMetrics,
  BugPriority,
  BugReport,
  BugReproducibility,
  BugSeverity,
  BugTriageSuggestion,
  Story,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import {
  acceptanceForStory,
  bugMetrics as computeBugMetrics,
  createAcceptance,
  createBugReport,
  createStory,
  getBugReport,
  getProject,
  getStory,
  listBugReports,
  updateBugReport,
} from './db';
import { getGlobalSettings } from './settings';
import { runReadOnlyPrompt } from './acp/utility';
import { bugTriagePrompt, parseJsonBlock } from './templates';

function bugText(bug: BugReport): string {
  return [bug.title, bug.description, bug.steps, bug.expected, bug.actual, bug.environment].join('\n');
}

function normalize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_]+/g) ?? [];
  const cjk = lower.replace(/[^\u4e00-\u9fa5]/g, '');
  const bigrams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i++) bigrams.push(cjk.slice(i, i + 2));
  return [...new Set([...latin, ...bigrams])];
}

function similarity(a: string, b: string): number {
  const left = new Set(normalize(a));
  const right = new Set(normalize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.sqrt(left.size * right.size);
}

export function duplicateCandidates(projectId: string, text: string, excludeId?: string): BugDuplicateCandidate[] {
  return listBugReports({ projectId })
    .filter((bug) => bug.id !== excludeId && !['closed', 'rejected'].includes(bug.status))
    .map((bug) => ({
      bugId: bug.id,
      title: bug.title,
      status: bug.status,
      severity: bug.severity,
      score: similarity(text, bugText(bug)),
    }))
    .filter((item) => item.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function reportBug(
  storyId: string,
  input: {
    title: string;
    description?: string;
    steps: string;
    expected: string;
    actual: string;
    acIds?: string[];
    environment?: string;
    evidence?: string[];
    severity?: BugSeverity;
    priority?: BugPriority;
    reproducibility?: BugReproducibility;
    reporter?: string;
    externalId?: string | null;
    externalUrl?: string | null;
  },
): BugReport {
  const story = getStory(storyId);
  if (!input.title?.trim() || !input.steps?.trim() || !input.expected?.trim() || !input.actual?.trim()) {
    throw new Error('Bug 反馈必须填写标题、复现步骤、期望结果与实际结果');
  }
  const acIds = input.acIds ?? [];
  const knownAcs = new Set(acceptanceForStory(storyId).map((ac) => ac.acId));
  for (const acId of acIds) {
    if (!knownAcs.has(acId)) throw new Error(`未知的验收标准：${acId}`);
  }
  const settings = getGlobalSettings();
  const slaDueAt =
    settings.bugSlaDays > 0
      ? new Date(Date.now() + settings.bugSlaDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
  const bug = createBugReport({
    projectId: story.projectId,
    storyId,
    requirementId: story.requirementId,
    acIds,
    title: input.title,
    description: input.description,
    steps: input.steps,
    expected: input.expected,
    actual: input.actual,
    environment: input.environment,
    evidence: input.evidence,
    severity: input.severity,
    priority: input.priority,
    reproducibility: input.reproducibility,
    reporter: input.reporter,
    slaDueAt,
    externalId: input.externalId,
    externalUrl: input.externalUrl,
  });
  bus.publish(storyId, {
    type: 'bug.reported',
    bugId: bug.id,
    storyId,
    severity: bug.severity,
    priority: bug.priority,
  });
  return bug;
}

export async function suggestBugTriage(id: string): Promise<BugTriageSuggestion> {
  const bug = getBugReport(id);
  const text = bugText(bug).toLowerCase();
  let severity: BugSeverity = 'major';
  if (/(崩溃|crash|数据丢失|data loss|安全|security|无法使用|不可用|500|白屏)/i.test(text)) severity = 'critical';
  if (/(阻塞|blocker|全部失败|支付失败|登录失败)/i.test(text)) severity = 'blocker';
  if (/(文案|样式|错别字|对齐|颜色|图标)/i.test(text)) severity = 'minor';
  const priority: BugPriority = severity === 'blocker' ? 'P0' : severity === 'critical' ? 'P1' : severity === 'major' ? 'P2' : 'P3';
  const reproducibility: BugReproducibility = /(偶现|sometimes|偶尔)/i.test(text)
    ? 'sometimes'
    : /(一次|once|偶发)/i.test(text)
      ? 'once'
      : /(必现|always|总是)/i.test(text)
        ? 'always'
        : bug.reproducibility;
  const candidates = duplicateCandidates(bug.projectId, text, bug.id);
  const heuristic: BugTriageSuggestion = {
    severity: bug.severity === 'major' && severity !== 'major' ? severity : bug.severity,
    priority: bug.priority === 'P2' && priority !== 'P2' ? priority : bug.priority,
    reproducibility,
    acIds: bug.acIds,
    duplicateCandidates: candidates,
    summary: '基于关键词、复现描述与相似 Bug 的规则建议；请人工确认后写入。',
    source: 'heuristic',
  };
  try {
    const story = getStory(bug.storyId);
    const project = getProject(bug.projectId);
    const response = await runReadOnlyPrompt({
      streamId: bug.id,
      sessionStoryId: bug.storyId,
      project,
      prompt: bugTriagePrompt({
        title: bug.title,
        description: bug.description,
        steps: bug.steps,
        expected: bug.expected,
        actual: bug.actual,
        environment: bug.environment,
        storyTitle: story.title,
        storyDescription: story.description,
        acceptanceCriteria: story.acceptanceCriteria,
        candidates: candidates.map((item) => `${item.bugId} ${item.title} (${(item.score * 100).toFixed(0)}%)`),
      }),
    });
    const raw = parseJsonBlock<{
      severity?: string;
      priority?: string;
      reproducibility?: string;
      duplicateBugIds?: string[];
      summary?: string;
    }>(response);
    const severities: BugSeverity[] = ['blocker', 'critical', 'major', 'minor'];
    const priorities: BugPriority[] = ['P0', 'P1', 'P2', 'P3'];
    const reproducibilities: BugReproducibility[] = ['always', 'often', 'sometimes', 'once'];
    if (!raw || !severities.includes(raw.severity as BugSeverity) || !priorities.includes(raw.priority as BugPriority)) {
      return heuristic;
    }
    const duplicateIds = new Set(raw.duplicateBugIds ?? []);
    return {
      severity: raw.severity as BugSeverity,
      priority: raw.priority as BugPriority,
      reproducibility: reproducibilities.includes(raw.reproducibility as BugReproducibility)
        ? (raw.reproducibility as BugReproducibility)
        : heuristic.reproducibility,
      acIds: bug.acIds,
      duplicateCandidates: candidates.filter((item) => duplicateIds.size === 0 || duplicateIds.has(item.bugId)),
      summary: raw.summary?.trim() || 'AI 分诊建议；请人工确认后写入。',
      source: 'ai',
    };
  } catch (err) {
    console.error('[bug-triage] AI suggestion failed', err instanceof Error ? err.message : String(err));
    return heuristic;
  }
}

export function triageBug(
  id: string,
  input: {
    severity?: BugSeverity;
    priority?: BugPriority;
    reproducibility?: BugReproducibility;
    acIds?: string[];
    duplicateOf?: string | null;
    triageNote?: string | null;
  },
): BugReport {
  const bug = getBugReport(id);
  if (['closed', 'rejected', 'duplicate'].includes(bug.status)) throw new Error(`Bug 状态 ${bug.status} 不允许分诊`);
  if (input.duplicateOf) {
    if (input.duplicateOf === id) throw new Error('Bug 不能标记为自身重复');
    const duplicate = getBugReport(input.duplicateOf);
    if (duplicate.projectId !== bug.projectId) throw new Error('重复 Bug 必须属于同一项目');
  }
  const from = bug.status;
  const to = input.duplicateOf ? 'duplicate' : 'triaged';
  const updated = updateBugReport(id, {
    severity: input.severity,
    priority: input.priority,
    reproducibility: input.reproducibility,
    acIds: input.acIds,
    duplicateOf: input.duplicateOf ?? null,
    triageNote: input.triageNote ?? bug.triageNote,
    status: to,
  });
  if (from !== to) bus.publish(bug.storyId, { type: 'bug.status', bugId: id, storyId: bug.storyId, from, to });
  return updated;
}

export function acceptBug(
  id: string,
  input: { regressionTest?: string; strategy?: 'auto' | 'rework' | 'fix_story' } = {},
): { mode: 'rework' | 'fix_story'; bug: BugReport; story: Story } {
  const bug = getBugReport(id);
  if (!['triaged', 'accepted', 'reopened'].includes(bug.status)) throw new Error(`Bug 状态 ${bug.status} 不允许接受`);
  if (!bug.steps.trim() || !bug.expected.trim() || !bug.actual.trim()) throw new Error('Bug 缺少复现步骤、期望或实际结果');
  const story = getStory(bug.storyId);
  const mode = input.strategy === 'rework' || input.strategy === 'fix_story'
    ? input.strategy
    : story.status === 'in_dev' || story.status === 'review'
      ? 'rework'
      : 'fix_story';
  if (mode === 'rework') {
    if (!['in_dev', 'review'].includes(story.status)) throw new Error(`故事状态 ${story.status} 不能直接返工，请创建修复故事`);
    const updated = updateBugReport(id, {
      status: 'fixing',
      fixStoryId: story.id,
      triageNote: bug.triageNote ?? '关联当前故事返工',
    });
    bus.publish(story.id, { type: 'bug.status', bugId: id, storyId: story.id, from: bug.status, to: 'fixing' });
    return { mode, bug: updated, story };
  }
  if (story.status !== 'done') throw new Error(`只有已完成故事会自动创建修复故事；当前 ${story.status}`);
  const regressionTest = input.regressionTest?.trim() || `bug ${id.slice(0, 8)} regression`;
  const fixStory = createStory({
    projectId: bug.projectId,
    title: `修复 Bug：${bug.title}`,
    description: [
      `来源 Bug：${bug.title}`,
      `原故事：${story.title}`,
      `复现步骤：${bug.steps}`,
      `期望：${bug.expected}`,
      `实际：${bug.actual}`,
      bug.environment ? `环境：${bug.environment}` : '',
      `回归测试：${regressionTest}`,
    ]
      .filter(Boolean)
      .join('\n'),
    acceptanceCriteria: [
      `Given 原故事「${story.title}」的缺陷可以复现`,
      `When 应用修复`,
      `Then 实际结果变为期望结果，且测试 ${regressionTest} 通过`,
    ].join('\n'),
    requirementId: bug.requirementId,
    bugId: bug.id,
    sourceStoryId: story.id,
    sourceVersion: story.sourceVersion,
    sourceVersionId: story.sourceVersionId,
    sourceStoryKey: story.sourceStoryKey,
    sourceClause: story.sourceClause,
  });
  createAcceptance(fixStory.id, {
    acId: 'AC1',
    given: `原故事「${story.title}」的缺陷可以复现`,
    when: '应用修复',
    then: '实际结果变为期望结果，且回归测试通过',
    test: regressionTest,
  });
  const updated = updateBugReport(id, {
    status: 'fixing',
    fixStoryId: fixStory.id,
    regressionTest,
    triageNote: bug.triageNote ?? '已创建关联修复故事',
  });
  bus.publish(story.id, { type: 'bug.status', bugId: id, storyId: story.id, from: bug.status, to: 'fixing' });
  bus.publish(story.id, { type: 'bug.fix_created', bugId: id, storyId: story.id, fixStoryId: fixStory.id });
  return { mode, bug: updated, story: fixStory };
}

export function markBugFixedForStory(storyId: string): BugReport | null {
  const story = getStory(storyId);
  const linked = story.bugId
    ? [getBugReport(story.bugId)]
    : listBugReports({ projectId: story.projectId }).filter((bug) => bug.fixStoryId === storyId);
  const bug = linked.find((item) => ['fixing', 'accepted'].includes(item.status));
  if (!bug) return linked[0] ?? null;
  const updated = updateBugReport(bug.id, { status: 'fixed' });
  bus.publish(bug.storyId, { type: 'bug.status', bugId: bug.id, storyId: bug.storyId, from: bug.status, to: 'fixed' });
  return updated;
}

export function verifyBug(id: string, resolution?: string): BugReport {
  const bug = getBugReport(id);
  if (bug.status !== 'fixed') throw new Error(`Bug 状态 ${bug.status} 不允许验证，需先修复`);
  const updated = updateBugReport(id, { status: 'verified', resolution: resolution?.trim() || bug.resolution });
  bus.publish(bug.storyId, { type: 'bug.status', bugId: id, storyId: bug.storyId, from: 'fixed', to: 'verified' });
  return updated;
}

export function closeBug(id: string, resolution?: string): BugReport {
  const bug = getBugReport(id);
  if (bug.status !== 'verified') throw new Error(`Bug 状态 ${bug.status} 不允许关闭，需先人工验证`);
  const updated = updateBugReport(id, { status: 'closed', resolution: resolution?.trim() || bug.resolution });
  bus.publish(bug.storyId, { type: 'bug.status', bugId: id, storyId: bug.storyId, from: 'verified', to: 'closed' });
  return updated;
}

export function rejectBug(id: string, reason: string): BugReport {
  const bug = getBugReport(id);
  if (!reason.trim()) throw new Error('拒绝 Bug 需要填写原因');
  if (!['new', 'triaged', 'reopened'].includes(bug.status)) throw new Error(`Bug 状态 ${bug.status} 不允许拒绝`);
  const updated = updateBugReport(id, { status: 'rejected', resolution: reason.trim() });
  bus.publish(bug.storyId, { type: 'bug.status', bugId: id, storyId: bug.storyId, from: bug.status, to: 'rejected' });
  return updated;
}

export function reopenBug(id: string, reason: string): BugReport {
  const bug = getBugReport(id);
  if (!reason.trim()) throw new Error('重开 Bug 需要填写原因');
  if (!['fixed', 'verified', 'closed'].includes(bug.status)) throw new Error(`Bug 状态 ${bug.status} 不允许重开`);
  const updated = updateBugReport(id, {
    status: 'reopened',
    reopenCount: bug.reopenCount + 1,
    triageNote: reason.trim(),
  });
  bus.publish(bug.storyId, { type: 'bug.status', bugId: id, storyId: bug.storyId, from: bug.status, to: 'reopened' });
  return updated;
}

export function bugs(projectId?: string, status?: BugReport['status'], storyId?: string): BugReport[] {
  return listBugReports({ projectId, status, storyId });
}

export function bugMetrics(projectId?: string): BugMetrics {
  return computeBugMetrics(projectId);
}
