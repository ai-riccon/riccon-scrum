import type { GlobalSettings } from '@riccon-scrum/shared';
import { db } from './db';
import { AGENT_KINDS } from './acp/agents';
import { config } from './config';

const KEY = 'global';

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  wipLimit: config.wipLimit,
  maxTurns: config.budgets.maxTurns,
  maxWallMs: config.budgets.maxWallMs,
  maxTokens: config.budgets.maxTokens,
  idleReapMs: Number(process.env.IDLE_REAP_MS ?? 10 * 60 * 1000),
  defaultAgentKind: process.env.DEFAULT_AGENT_KIND ?? 'opencode',
  requireMachineDod: process.env.REQUIRE_MACHINE_DOD !== '0',
  embeddingUrl: config.embeddingUrl,
  embeddingApiKey: config.embeddingApiKey,
  embeddingModel: config.embeddingModel,
  taskPlanning: process.env.TASK_PLANNING !== '0',
  maxStoryTasks: Number(process.env.MAX_STORY_TASKS ?? 8),
  maxTaskAttempts: Number(process.env.MAX_TASK_ATTEMPTS ?? 2),
  taskPlanReview: (process.env.TASK_PLAN_REVIEW as GlobalSettings['taskPlanReview']) ?? 'never',
  parallelTasks: process.env.PARALLEL_TASKS === '1',
  maxParallelTasks: Number(process.env.MAX_PARALLEL_TASKS ?? 2),
  taskContextChars: Number(process.env.TASK_CONTEXT_CHARS ?? 12_000),
  bugSlaDays: Number(process.env.BUG_SLA_DAYS ?? 7),
};

export function getGlobalSettings(): GlobalSettings {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_GLOBAL_SETTINGS };
  try {
    return { ...DEFAULT_GLOBAL_SETTINGS, ...(JSON.parse(row.value) as Partial<GlobalSettings>) };
  } catch {
    return { ...DEFAULT_GLOBAL_SETTINGS };
  }
}

function num(value: unknown, min: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`${label}必须是不小于 ${min} 的数字`);
  return Math.floor(n);
}

export function updateGlobalSettings(patch: Partial<GlobalSettings>): GlobalSettings {
  const next: GlobalSettings = { ...getGlobalSettings() };
  if (patch.wipLimit !== undefined) next.wipLimit = num(patch.wipLimit, 1, 'WIP 上限');
  if (patch.maxTurns !== undefined) next.maxTurns = num(patch.maxTurns, 1, '最大循环轮次');
  if (patch.maxWallMs !== undefined) next.maxWallMs = num(patch.maxWallMs, 60_000, '墙钟预算');
  if (patch.maxTokens !== undefined) next.maxTokens = num(patch.maxTokens, 1000, 'Token 预算');
  if (patch.idleReapMs !== undefined) next.idleReapMs = num(patch.idleReapMs, 0, '空闲回收时长');
  if (patch.defaultAgentKind !== undefined) {
    if (!(AGENT_KINDS as readonly string[]).includes(patch.defaultAgentKind)) {
      throw new Error(`未知 agent 终端：${patch.defaultAgentKind}`);
    }
    next.defaultAgentKind = patch.defaultAgentKind;
  }
  if (patch.requireMachineDod !== undefined) next.requireMachineDod = Boolean(patch.requireMachineDod);
  if (patch.embeddingUrl !== undefined) next.embeddingUrl = String(patch.embeddingUrl).trim();
  if (patch.embeddingApiKey !== undefined) next.embeddingApiKey = String(patch.embeddingApiKey).trim();
  if (patch.embeddingModel !== undefined) {
    const model = String(patch.embeddingModel).trim();
    if (!model) throw new Error('向量检索模型不能为空');
    next.embeddingModel = model;
  }
  if (patch.taskPlanning !== undefined) next.taskPlanning = Boolean(patch.taskPlanning);
  if (patch.maxStoryTasks !== undefined) next.maxStoryTasks = Math.min(12, num(patch.maxStoryTasks, 1, '单故事最大任务数'));
  if (patch.maxTaskAttempts !== undefined) next.maxTaskAttempts = Math.min(5, num(patch.maxTaskAttempts, 1, '单任务最大尝试次数'));
  if (patch.taskPlanReview !== undefined) {
    if (!['never', 'risky', 'always'].includes(patch.taskPlanReview)) throw new Error('未知的任务计划审批模式');
    next.taskPlanReview = patch.taskPlanReview;
  }
  if (patch.parallelTasks !== undefined) next.parallelTasks = Boolean(patch.parallelTasks);
  if (patch.maxParallelTasks !== undefined) next.maxParallelTasks = Math.min(4, num(patch.maxParallelTasks, 1, '最大并行任务数'));
  if (patch.taskContextChars !== undefined) next.taskContextChars = num(patch.taskContextChars, 2000, '任务上下文预算');
  if (patch.bugSlaDays !== undefined) next.bugSlaDays = num(patch.bugSlaDays, 0, 'Bug SLA 天数');
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(KEY, JSON.stringify(next), new Date().toISOString());
  return next;
}
