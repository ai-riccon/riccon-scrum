import type { AgentRole, TeamPhase, TeamPlanTask } from '@acp-scrum/shared';
import { bus } from './bus';
import { config } from './config';
import {
  activeStoryScopes,
  addStoryFiles,
  createTeamRun,
  getProject,
  getStory,
  getTeamRun,
  updateTeamRun,
} from './db';
import { manager } from './acp/manager';
import { devPrompt, leadPrompt, normalizePlan, normalizeVerdict, parseJsonBlock, qaPrompt } from './templates';
import { evaluateDod, storyDiff, transition } from './ops';
import { getIndexContext } from './indexer';

class BudgetExceededError extends Error {
  constructor(public kind: 'turns' | 'time' | 'tokens', detail: string) {
    super(detail);
  }
}

function checkBudget(storyId: string): void {
  const run = getTeamRun(storyId);
  if (!run) return;
  const { maxTurns, maxWallMs, maxTokens } = config.budgets;
  if (run.turns >= maxTurns) throw new BudgetExceededError('turns', `循环 ${run.turns} ≥ 上限 ${maxTurns}`);
  if (Date.now() - new Date(run.startedAt).getTime() > maxWallMs) {
    throw new BudgetExceededError('time', `耗时超过 ${Math.round(maxWallMs / 60000)} 分钟`);
  }
  if (run.tokens >= maxTokens) throw new BudgetExceededError('tokens', `token ${run.tokens} ≥ 上限 ${maxTokens}`);
}

async function runPhase(storyId: string, role: AgentRole, phase: TeamPhase, prompt: string): Promise<string> {
  checkBudget(storyId);
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  if (!story.worktreePath) throw new Error('story has no worktree');
  updateTeamRun(storyId, { phase });
  const session = await manager.startRunner(storyId, story.worktreePath, [story.worktreePath], project.agentKind, role);
  bus.publish(storyId, { type: 'team.phase', phase, role, sessionId: session.id });
  try {
    const { text } = await manager.prompt(session.id, prompt);
    return text;
  } finally {
    await manager.stopRunner(session.id);
  }
}

async function conflictGate(storyId: string, plan: TeamPlanTask[]): Promise<void> {
  const planned = plan.flatMap((t) => t.files);
  if (planned.length > 0) addStoryFiles(storyId, planned);
  const myFiles = new Set(planned);
  for (const other of activeStoryScopes(storyId)) {
    const overlap = other.files.filter((f) => myFiles.has(f));
    if (overlap.length === 0) continue;
    bus.publish(storyId, { type: 'conflict.detected', otherStoryId: other.storyId, otherTitle: other.title, files: overlap });
    const decision = await manager.requestDecision(
      storyId,
      'conflict',
      `文件冲突：与「${other.title}」重叠 ${overlap.length} 个文件`,
      JSON.stringify({ otherStoryId: other.storyId, files: overlap }),
    );
    if (decision.status === 'denied') {
      throw new Error('人工因文件冲突暂停了该故事');
    }
  }
}

export async function runTeamCycle(storyId: string): Promise<void> {
  const story = getStory(storyId);
  const project = getProject(story.projectId);
  createTeamRun(storyId);
  const codeContext = getIndexContext(project.id, `${story.title} ${story.description}`);

  try {
    const leadText = await runPhase(storyId, 'lead', 'plan', leadPrompt(story, project.dodCommands, codeContext));
    const plan = normalizePlan(parseJsonBlock(leadText));
    updateTeamRun(storyId, { plan });
    bus.publish(storyId, { type: 'team.plan', tasks: plan });
    await conflictGate(storyId, plan);

    await runPhase(storyId, 'dev', 'implement', devPrompt(story, project.dodCommands, plan, codeContext));

    let rework = 0;
    for (;;) {
      checkBudget(storyId);
      const diff = await storyDiff(storyId);
      const qaText = await runPhase(storyId, 'qa', 'verify', qaPrompt(story, project.dodCommands, diff));
      const verdict = normalizeVerdict(parseJsonBlock(qaText)) ?? { pass: true, issues: [] };
      updateTeamRun(storyId, { verdict, phase: 'gate' });
      bus.publish(storyId, { type: 'team.verdict', verdict });

      const dodPass = await evaluateDod(storyId);
      if (dodPass && verdict.pass) {
        transition(storyId, 'review');
        return;
      }

      if (rework >= config.maxRework) {
        bus.publish(storyId, {
          type: 'agent.message',
          sessionId: '',
          role: 'agent',
          text: `[平台] 达到最大返工次数（${config.maxRework}），故事转为 blocked，需人工介入。`,
        });
        transition(storyId, 'blocked');
        return;
      }
      rework++;
      const issues = [...verdict.issues, ...(dodPass ? [] : ['DoD 门禁命令未全部通过'])];
      const fixPrompt =
        devPrompt(story, project.dodCommands, plan, codeContext) +
        '\n\n## 上轮评审问题（必须修复）\n' +
        issues.map((i) => `- ${i}`).join('\n');
      await runPhase(storyId, 'dev', 'implement', fixPrompt);
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      bus.publish(storyId, { type: 'budget.exceeded', kind: err.kind, detail: err.message });
      transition(storyId, 'blocked');
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    bus.publish(storyId, { type: 'session.status', sessionId: '', status: 'error', detail });
    if (getStory(storyId).status === 'in_dev') transition(storyId, 'blocked');
  }
}