import assert from 'node:assert/strict';
import type { StoryTask, StoryTaskEdge } from '@riccon-scrum/shared';
import { criticalPath, topoOrder, validateTaskPlan } from '../task-plan';

function task(key: string, seq: number, status: StoryTask['status'] = 'pending'): StoryTask {
  return {
    id: `id-${key}`,
    projectId: 'p',
    storyId: 's',
    seq,
    key,
    title: `任务 ${key}`,
    description: '',
    files: [`src/${key}.ts`],
    acIds: [],
    verifyCommand: null,
    status,
    attempts: 0,
    evidence: null,
    sessionId: null,
    worktreePath: null,
    branch: null,
    tokens: 0,
    source: 'ai',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const tasks = [task('T1', 1), task('T2', 2), task('T3', 3)];
const edges: StoryTaskEdge[] = [
  { taskId: 'id-T4', dependsOnTaskId: 'id-T1' },
  { taskId: 'id-T2', dependsOnTaskId: 'id-T1' },
  { taskId: 'id-T3', dependsOnTaskId: 'id-T2' },
].filter((edge) => tasks.some((item) => item.id === edge.taskId) || edge.taskId === 'id-T4');
assert.deepEqual(topoOrder(tasks, edges).map((item) => item.key), ['T1', 'T2', 'T3']);
assert.deepEqual(criticalPath(tasks, edges), ['T1', 'T2', 'T3']);

const valid = validateTaskPlan(
  [
    { key: 'T1', title: '数据模型', description: '', files: [], acIds: ['AC1'], dependsOn: [], verifyCommand: 'npm run typecheck' },
    { key: 'T2', title: '调度器', description: '', files: [], acIds: ['AC2'], dependsOn: ['T1'], verifyCommand: null },
  ],
  ['AC1', 'AC2'],
  8,
  2,
);
assert.equal(valid.filter((issue) => issue.severity === 'error').length, 0, JSON.stringify(valid));

const cycle = validateTaskPlan(
  [
    { key: 'T1', title: 'A', description: '', files: [], acIds: ['AC1'], dependsOn: ['T2'], verifyCommand: null },
    { key: 'T2', title: 'B', description: '', files: [], acIds: ['AC2'], dependsOn: ['T1'], verifyCommand: null },
  ],
  ['AC1', 'AC2'],
  8,
  2,
);
assert.ok(cycle.some((issue) => issue.code === 'task-dep-cycle'));

const missingAc = validateTaskPlan(
  [
    { key: 'T1', title: 'A', description: '', files: [], acIds: ['AC1'], dependsOn: [], verifyCommand: null },
    { key: 'T2', title: 'B', description: '', files: [], acIds: [], dependsOn: [], verifyCommand: null },
  ],
  ['AC1', 'AC2'],
  8,
  2,
);
assert.ok(missingAc.some((issue) => issue.code === 'task-ac-uncovered'));

const replan = validateTaskPlan(
  [{ key: 'T3', title: '剩余任务', description: '', files: [], acIds: ['AC2'], dependsOn: ['T1', 'T2'], verifyCommand: null }],
  ['AC1', 'AC2'],
  8,
  1,
  [
    { key: 'T1', acIds: ['AC1'] },
    { key: 'T2', acIds: [] },
  ],
);
assert.equal(replan.filter((issue) => issue.severity === 'error').length, 0, JSON.stringify(replan));

console.log('[task-plan-check] topo/cycle/coverage/critical-path/replan OK');
