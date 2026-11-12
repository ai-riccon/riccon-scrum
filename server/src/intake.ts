import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type {
  EventPayload,
  Project,
  Requirement,
  RequirementConversation,
  RequirementIntake,
  RequirementMessage,
  RequirementStatus,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import { config } from './config';
import {
  addRequirementMessage,
  createRequirement,
  getProject,
  getRequirement,
  latestRequirementVersion,
  listRequirementMessages,
  setRequirementStatus,
  updateRequirementIntake,
  updateRequirementTitle,
} from './db';
import { AcpRunner, type RunnerHost } from './acp/runner';
import { getAgentSpec } from './acp/agents';
import { parseJsonBlock, requirementInterviewPrompt } from './templates';
import { createDetachedWorktree, currentBranch, removeWorktree } from './git';
import { approveRequirement, generateRequirementDraft } from './discovery';

const MAX_ROUNDS = 3;
const TURN_TIMEOUT_MS = 3 * 60_000;
const MAX_TRANSCRIPT_CHARS = 12_000;
const TITLE_MAX = 24;

interface IntakeSession {
  requirementId: string;
  repoPath: string;
  worktree: string;
  runner: AcpRunner;
  acpSessionId: string | null;
  idleTimer: NodeJS.Timeout | null;
}

const activeTurns = new Set<string>();
const confirming = new Set<string>();
const sessions = new Map<string, IntakeSession>();
const activeWorktrees = new Set<string>();

function sweepIntakeWorktrees(): void {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith('riccon-intake-')) continue;
    const full = path.join(tmp, name);
    if (activeWorktrees.has(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // still locked; next sweep will retry
    }
  }
}

function raceTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, Math.max(1, ms));
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIntake(raw: unknown): Partial<RequirementIntake> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  return {
    goal: asText(r.goal ?? r.objective),
    users: asText(r.users ?? r.personas ?? r.audience),
    constraints: asText(r.constraints),
    nonGoals: asText(r.nonGoals ?? r.non_goals ?? r.outOfScope),
    successMetrics: asText(r.successMetrics ?? r.success_metrics ?? r.metrics),
    examples: asText(r.examples ?? r.scenarios),
  };
}

function mergeIntake(current: RequirementIntake | null, patch: Partial<RequirementIntake>): RequirementIntake {
  return {
    goal: patch.goal || current?.goal || '',
    users: patch.users || current?.users || '',
    constraints: patch.constraints || current?.constraints || '',
    nonGoals: patch.nonGoals || current?.nonGoals || '',
    successMetrics: patch.successMetrics || current?.successMetrics || '',
    examples: patch.examples || current?.examples || '',
  };
}

function intakeComplete(intake: RequirementIntake): boolean {
  return Boolean(intake.goal.trim() && intake.users.trim() && intake.successMetrics.trim());
}

function formatTranscript(messages: RequirementMessage[]): string {
  const lines = messages.slice(-24).map((m) => {
    const text = m.content.length > 2000 ? m.content.slice(0, 2000) + '…' : m.content;
    return `[${m.role === 'user' ? '用户' : '访谈官'}] ${text}`;
  });
  let joined = lines.join('\n');
  if (joined.length > MAX_TRANSCRIPT_CHARS) joined = '…（更早对话已省略）\n' + joined.slice(-MAX_TRANSCRIPT_CHARS);
  return joined;
}

function provisionalTitle(message: string): string {
  const first = message.split('\n').map((s) => s.trim()).find(Boolean) ?? '新需求';
  return first.length > TITLE_MAX ? first.slice(0, TITLE_MAX) + '…' : first;
}

function moveRequirement(id: string, to: RequirementStatus): Requirement {
  const before = getRequirement(id);
  if (before.status === to) return before;
  const after = setRequirementStatus(id, to);
  bus.publish(id, { type: 'requirement.status', requirementId: id, from: before.status, to: after.status });
  return after;
}

function intakeHost(requirementId: string): RunnerHost {
  return {
    publish: (streamId: string, payload: EventPayload) => {
      if (streamId !== requirementId) return;
      if (payload.type !== 'session.status') return;
      bus.publish(requirementId, payload);
    },
    requestPermission: async (
      _storyId: string,
      _sessionId: string,
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      const kind = params.toolCall.kind ?? null;
      const allow =
        params.options.find((o) => o.kind === 'allow_once') ?? params.options.find((o) => o.kind.startsWith('allow'));
      if (allow && (kind === 'read' || kind === 'search')) {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } };
      }
      return { outcome: { outcome: 'cancelled' } };
    },
  };
}

function publishChat(requirementId: string, role: 'user' | 'agent', ready: boolean): void {
  bus.publish(requirementId, { type: 'requirement.chat', requirementId, role, ready });
}

function appendUserMessage(requirementId: string, content: string): RequirementMessage {
  const message = addRequirementMessage({ requirementId, role: 'user', content });
  publishChat(requirementId, 'user', false);
  return message;
}

function appendAgentMessage(requirementId: string, content: string, ready = false): RequirementMessage {
  const message = addRequirementMessage({ requirementId, role: 'agent', content, ready });
  publishChat(requirementId, 'agent', ready);
  return message;
}

function ensureChatState(requirement: Requirement): void {
  if (!['intake', 'clarifying', 'blocked'].includes(requirement.status)) {
    throw new Error(`需求状态 ${requirement.status} 不允许继续澄清`);
  }
  if (requirement.currentVersion > 0) throw new Error('已生成草稿，请使用反馈或重新生成');
}

function buildRunner(requirementId: string, project: Project, worktree: string): AcpRunner {
  const model = project.discoveryModel || project.model;
  const spec = getAgentSpec(project.agentKind, {
    model: model || config.agentModel,
    dbPath: config.opencodeDb,
  });
  return new AcpRunner({
    storyId: requirementId,
    sessionId: `intake-${requirementId.slice(0, 8)}-${Date.now()}`,
    cwd: worktree,
    spec,
    host: intakeHost(requirementId),
    allowedRoots: [worktree],
    model: model || undefined,
  });
}

async function disposeSession(session: IntakeSession, removeDir = true): Promise<void> {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
  if (sessions.get(session.requirementId) === session) sessions.delete(session.requirementId);
  await session.runner.stop().catch(() => undefined);
  activeWorktrees.delete(session.worktree);
  if (!removeDir) return;
  await removeWorktree(session.repoPath, session.worktree).catch(() => undefined);
  try {
    fs.rmSync(session.worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // next sweep will retry
  }
}

function scheduleIdle(session: IntakeSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    if (sessions.get(session.requirementId) !== session) return;
    void disposeSession(session);
  }, config.intakeIdleMs);
  session.idleTimer.unref();
}

async function acquireSession(
  requirement: Requirement,
  project: Project,
): Promise<{ session: IntakeSession; reused: boolean }> {
  const existing = sessions.get(requirement.id);
  if (existing) {
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    if (existing.runner.alive) return { session: existing, reused: true };
    if (fs.existsSync(existing.worktree)) {
      await existing.runner.stop().catch(() => undefined);
      if (existing.acpSessionId) {
        const resumed = buildRunner(requirement.id, project, existing.worktree);
        try {
          await raceTimeout(
            resumed.start(existing.acpSessionId),
            60_000,
            () => void resumed.stop().catch(() => undefined),
            'agent 恢复超时',
          );
          existing.runner = resumed;
          existing.acpSessionId = resumed.sessionId;
          return { session: existing, reused: true };
        } catch {
          await resumed.stop().catch(() => undefined);
        }
      }
      const fresh = buildRunner(requirement.id, project, existing.worktree);
      await raceTimeout(fresh.start(), 60_000, () => void fresh.stop().catch(() => undefined), 'agent 启动超时');
      existing.runner = fresh;
      existing.acpSessionId = fresh.sessionId;
      return { session: existing, reused: false };
    }
    await disposeSession(existing);
  }

  const worktree = path.join(os.tmpdir(), `riccon-intake-${requirement.id.slice(0, 8)}-${Date.now()}`);
  const base = project.defaultBranch || (await currentBranch(project.repoPath));
  sweepIntakeWorktrees();
  await createDetachedWorktree(project.repoPath, worktree, base);
  activeWorktrees.add(worktree);
  const runner = buildRunner(requirement.id, project, worktree);
  try {
    await raceTimeout(runner.start(), 60_000, () => void runner.stop().catch(() => undefined), 'agent 启动超时');
  } catch (err) {
    await runner.stop().catch(() => undefined);
    activeWorktrees.delete(worktree);
    await removeWorktree(project.repoPath, worktree).catch(() => undefined);
    try {
      fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // next sweep will retry
    }
    throw err;
  }
  const session: IntakeSession = {
    requirementId: requirement.id,
    repoPath: project.repoPath,
    worktree,
    runner,
    acpSessionId: runner.sessionId,
    idleTimer: null,
  };
  sessions.set(requirement.id, session);
  return { session, reused: false };
}

function followUpPrompt(userText: string): string {
  return [
    `用户回答：${userText}`,
    '',
    '继续按访谈规则：每轮最多 3 个问题；已收集信息不要重复问；信息足够时 ready=true 并请用户确认；末尾必须输出一个 ```json 代码块：',
    '```json',
    JSON.stringify({
      ready: false,
      title: '12 字以内的需求标题',
      intake: {
        goal: '业务目标',
        users: '目标用户/角色',
        constraints: '技术、时间、合规等约束',
        nonGoals: '明确不做的事',
        successMetrics: '可衡量的成功指标',
        examples: '输入/输出示例或用户场景',
      },
    }),
    '```',
  ].join('\n');
}

export async function closeIntakeSession(requirementId: string): Promise<void> {
  const session = sessions.get(requirementId);
  if (session) await disposeSession(session);
}

export function isIntakeTurnRunning(requirementId: string): boolean {
  return activeTurns.has(requirementId) || confirming.has(requirementId);
}

export function getRequirementConversation(requirementId: string): RequirementConversation {
  const messages = listRequirementMessages(requirementId);
  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent');
  return {
    messages,
    ready: Boolean(lastAgent?.ready),
    running: isIntakeTurnRunning(requirementId),
  };
}

export function startIntakeConversation(projectId: string, message: string): Requirement {
  const text = message.trim();
  if (!text) throw new Error('请用一句话描述需求');
  const requirement = createRequirement({
    projectId,
    title: provisionalTitle(text),
    rawInput: text,
    source: 'chat',
  });
  appendUserMessage(requirement.id, text);
  moveRequirement(requirement.id, 'clarifying');
  void runIntakeTurn(requirement.id).catch((err) => console.error('[intake]', err));
  return getRequirement(requirement.id);
}

export function sendIntakeMessage(requirementId: string, message: string): RequirementMessage {
  const text = message.trim();
  if (!text) throw new Error('请提供消息内容');
  const requirement = getRequirement(requirementId);
  ensureChatState(requirement);
  if (activeTurns.has(requirementId)) throw new Error('需求澄清进行中，请稍候');
  if (confirming.has(requirementId)) throw new Error('需求确认处理中，请稍候');
  const saved = appendUserMessage(requirementId, text);
  void runIntakeTurn(requirementId).catch((err) => console.error('[intake]', err));
  return saved;
}

function parseInterviewReply(text: string): { visible: string; ready: boolean; title: string; intake: Partial<RequirementIntake> } {
  const parsed = parseJsonBlock<Record<string, unknown>>(text);
  const rawIntake = parsed?.intake ?? parsed?.requirementIntake ?? parsed?.intakeData;
  return {
    visible: text.replace(/```json[\s\S]*?```/g, '').trim() || '（信息已记录）',
    ready: parsed?.ready === true || parsed?.ready === 'true' || parsed?.isReady === true,
    title: asText(parsed?.title ?? parsed?.requirementTitle),
    intake: normalizeIntake(rawIntake),
  };
}

async function runIntakeTurn(requirementId: string): Promise<void> {
  if (activeTurns.has(requirementId)) throw new Error('需求澄清进行中，请稍候');
  if (confirming.has(requirementId)) throw new Error('需求确认处理中，请稍候');
  const requirement = getRequirement(requirementId);
  ensureChatState(requirement);
  activeTurns.add(requirementId);

  const project: Project = getProject(requirement.projectId);
  const messages = listRequirementMessages(requirementId);
  const round = Math.max(1, messages.filter((m) => m.role === 'user').length);
  let session: IntakeSession | null = null;

  try {
    const acquired = await acquireSession(requirement, project);
    session = acquired.session;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? requirement.rawInput;
    const prompt = acquired.reused
      ? followUpPrompt(lastUser)
      : requirementInterviewPrompt({
          projectName: project.name,
          title: requirement.title,
          rawInput: requirement.rawInput,
          glossary: project.glossary,
          intake: requirement.intake,
          transcript: formatTranscript(messages),
          round,
          maxRounds: MAX_ROUNDS,
        });
    await raceTimeout(
      session.runner.prompt(prompt),
      TURN_TIMEOUT_MS,
      () => void session?.runner.stop().catch(() => undefined),
      `澄清超时（${Math.round(TURN_TIMEOUT_MS / 1000)}s）`,
    );

    const reply = parseInterviewReply(session.runner.responseText);
    if (reply.title) updateRequirementTitle(requirementId, reply.title);
    const merged = mergeIntake(requirement.intake, reply.intake);
    const changed = JSON.stringify(merged) !== JSON.stringify(requirement.intake ?? {});
    if (changed) updateRequirementIntake(requirementId, merged);
    const complete = intakeComplete(merged);
    const forced = round >= MAX_ROUNDS && complete;
    const ready = complete && (reply.ready || forced);
    const visible = forced && !reply.ready
      ? `${reply.visible}\n\n信息已足够，可以确认生成；如有补充也可以继续回答。`
      : reply.visible;
    activeTurns.delete(requirementId);
    appendAgentMessage(requirementId, visible, ready);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    activeTurns.delete(requirementId);
    try {
      appendAgentMessage(requirementId, `[平台] 澄清会话失败：${detail}`);
    } finally {
      if (session) await disposeSession(session);
      session = null;
    }
  } finally {
    if (session && sessions.get(requirementId) === session) scheduleIdle(session);
  }
}

export function confirmIntake(requirementId: string): void {
  const requirement = getRequirement(requirementId);
  ensureChatState(requirement);
  if (activeTurns.has(requirementId)) throw new Error('需求澄清进行中，请稍候');
  if (confirming.has(requirementId)) throw new Error('需求确认处理中，请稍候');
  confirming.add(requirementId);
  void (async () => {
    try {
      const session = sessions.get(requirementId);
      if (session) await disposeSession(session);
      await generateRequirementDraft(requirementId, { confirmedIntake: true });
      const current = getRequirement(requirementId);
      const version = latestRequirementVersion(requirementId);
      const hasError = (version?.issues ?? []).some((issue) => issue.severity === 'error');
      if (current.status === 'in_review' && version?.draft && !hasError) {
        approveRequirement(requirementId);
      }
    } catch (err) {
      // generateRequirementDraft already publishes failure events
      console.error('[intake] confirm failed', err);
    } finally {
      confirming.delete(requirementId);
    }
  })();
}

export function cleanupIntakeState(): void {
  for (const session of sessions.values()) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    void session.runner.stop().catch(() => undefined);
  }
  sessions.clear();
  activeWorktrees.clear();
  activeTurns.clear();
  confirming.clear();
  sweepIntakeWorktrees();
}
