import type {
  Dependency,
  DependencyEntityType,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  DependencyItem,
  Handoff,
  Requirement,
  Story,
  StoryDependencyInfo,
} from '@riccon-scrum/shared';
import {
  acceptanceForStory,
  dodItemsForStory,
  deleteDependency,
  eventsForStory,
  getHandoff,
  getRequirement,
  getStory,
  insertDependency,
  latestRequirementVersion,
  listDependencies,
  listRequirements,
  listStories,
  saveHandoff,
} from './db';

const MAX_CONTEXT_CHARS = 4000;

function entityOf(type: DependencyEntityType, id: string): Requirement | Story {
  return type === 'requirement' ? getRequirement(id) : getStory(id);
}

export function validateDependency(input: {
  projectId: string;
  predecessorType: DependencyEntityType;
  predecessorId: string;
  successorType: DependencyEntityType;
  successorId: string;
}): void {
  if (input.predecessorType !== input.successorType) throw new Error('暂只支持同类型实体之间的依赖');
  if (input.predecessorId === input.successorId) throw new Error('不能依赖自身');
  const predecessor = entityOf(input.predecessorType, input.predecessorId);
  const successor = entityOf(input.successorType, input.successorId);
  if (predecessor.projectId !== input.projectId || successor.projectId !== input.projectId) {
    throw new Error('依赖双方必须属于同一项目');
  }
  const existing = listDependencies(input.projectId, input.predecessorType);
  if (
    existing.some(
      (d) => d.predecessorId === input.predecessorId && d.successorId === input.successorId,
    )
  ) {
    throw new Error('该依赖已存在');
  }
  if (wouldCreateCycle(existing, input.predecessorId, input.successorId)) {
    throw new Error('该依赖会形成循环，请调整前置关系');
  }
}

export function createDependency(input: {
  projectId: string;
  predecessorType: DependencyEntityType;
  predecessorId: string;
  successorType: DependencyEntityType;
  successorId: string;
  note?: string | null;
}): Dependency {
  validateDependency(input);
  return insertDependency(input);
}

function wouldCreateCycle(edges: Dependency[], from: string, to: string): boolean {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const list = graph.get(edge.predecessorId) ?? [];
    list.push(edge.successorId);
    graph.set(edge.predecessorId, list);
  }
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  return false;
}

export function removeDependency(id: string): void {
  deleteDependency(id);
}

function requirementDepth(id: string, cache = new Map<string, number>()): number {
  if (cache.has(id)) return cache.get(id) as number;
  const requirement = getRequirement(id);
  let depth = 1;
  if (requirement.parentRequirementId) {
    try {
      depth = requirementDepth(requirement.parentRequirementId, cache) + 1;
    } catch {
      depth = 1;
    }
  }
  cache.set(id, depth);
  return depth;
}

export function requirementDelivered(requirementId: string, seen = new Set<string>()): boolean {
  if (seen.has(requirementId)) return false;
  seen.add(requirementId);
  const requirement = getRequirement(requirementId);
  if (requirement.status === 'decomposed') {
    const stories = listStories(requirement.projectId).filter((story) => story.requirementId === requirementId);
    return stories.length > 0 && stories.every((story) => story.status === 'done');
  }
  if (requirement.status === 'split') {
    const children = listRequirements(requirement.projectId).filter(
      (item) => item.parentRequirementId === requirementId,
    );
    return children.length > 0 && children.every((child) => requirementDelivered(child.id, seen));
  }
  return false;
}

export function requirementBlockers(requirementId: string): DependencyItem[] {
  const requirement = getRequirement(requirementId);
  const deps = listDependencies(requirement.projectId, 'requirement').filter(
    (d) => d.successorId === requirementId,
  );
  return deps
    .map((d) => getRequirement(d.predecessorId))
    .filter((predecessor) => !requirementDelivered(predecessor.id))
    .map((predecessor) => ({
      id: predecessor.id,
      title: predecessor.title,
      status: predecessor.status,
      type: 'requirement' as const,
    }));
}

export function storyDependencyInfo(storyId: string): StoryDependencyInfo {
  const story = getStory(storyId);
  const deps = listDependencies(story.projectId, 'story');
  const predecessors = deps
    .filter((d) => d.successorId === storyId)
    .map((d) => getStory(d.predecessorId))
    .filter((s) => s.id !== storyId);
  const successors = deps
    .filter((d) => d.predecessorId === storyId)
    .map((d) => getStory(d.successorId))
    .filter((s) => s.id !== storyId);
  const blockedBy: DependencyItem[] = predecessors
    .filter((s) => s.status !== 'done')
    .map((s) => ({ id: s.id, title: s.title, status: s.status, type: 'story' as const }));
  if (story.requirementId) {
    blockedBy.push(...requirementBlockers(story.requirementId));
  }
  return {
    predecessors: predecessors.map((s) => ({ id: s.id, title: s.title, status: s.status, type: 'story' as const })),
    successors: successors.map((s) => ({ id: s.id, title: s.title, status: s.status, type: 'story' as const })),
    blockedBy,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function ensureStoryHandoff(storyId: string): Handoff | null {
  const existing = getHandoff('story', storyId);
  if (existing) return existing;
  const story = getStory(storyId);
  if (story.status !== 'done') return null;
  const events = eventsForStory(storyId);
  const contractEvent = [...events].reverse().find((event) => event.payload.type === 'contract.result');
  const contracts =
    contractEvent?.payload.type === 'contract.result'
      ? `${contractEvent.payload.ok ? '通过' : '失败'}：${contractEvent.payload.evidence.split('\n')[0]}`
      : null;
  const decisions: string[] = [];
  for (const event of events) {
    if (event.payload.type === 'approval.decided') {
      decisions.push(`${event.payload.approval.title}：${event.payload.approval.status}`);
    }
    if (event.payload.type === 'team.verdict') {
      decisions.push(`QA ${event.payload.verdict.pass ? '通过' : '不通过'}`);
    }
  }
  return saveHandoff({
    projectId: story.projectId,
    entityType: 'story',
    entityId: story.id,
    title: story.title,
    summary: story.description || story.title,
    files: [],
    contracts,
    migrations: [],
    dod: dodItemsForStory(storyId)
      .filter((item) => item.status === 'pass' && (item.command || item.kind === 'human'))
      .map((item) => `${item.label}: ${(item.evidence ?? 'pass').split('\n')[0]}`),
    acceptance: acceptanceForStory(storyId)
      .filter((item) => item.status === 'pass')
      .map((item) => `${item.acId}: ${item.then}`),
    decisions: decisions.slice(-8),
  });
}

function formatHandoff(handoff: Handoff): string {
  const lines = [
    `### 前置交付物：${handoff.title}`,
    `- 变更摘要：${truncate(handoff.summary, 900)}`,
    handoff.files.length
      ? `- 关键文件：${handoff.files.slice(0, 8).map((file) => `${file.path}(+${file.added}/-${file.removed})`).join('、')}`
      : '',
    handoff.contracts ? `- 接口/契约：${truncate(handoff.contracts, 400)}` : '',
    handoff.migrations.length ? `- 迁移/DDL：${handoff.migrations.join('、')}` : '',
    handoff.dod.length ? `- 测试/门禁：${handoff.dod.slice(0, 8).join('；')}` : '',
    handoff.acceptance.length ? `- 验收证据：${handoff.acceptance.slice(0, 8).join('；')}` : '',
    handoff.decisions.length ? `- 关键决策：${handoff.decisions.slice(0, 6).join('；')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function requirementContextBlock(requirement: Requirement): string {
  const version = latestRequirementVersion(requirement.id);
  const draft = version?.draft;
  const lines = [
    `### 前置需求：${requirement.title}（${requirement.status}）`,
    draft?.summary ? `- 摘要：${truncate(draft.summary, 600)}` : '',
    draft?.goals.length ? `- 目标：${draft.goals.join('；')}` : '',
    draft?.nonGoals.length ? `- 非目标：${draft.nonGoals.join('；')}` : '',
  ];
  const stories = listStories(requirement.projectId).filter((s) => s.requirementId === requirement.id);
  if (stories.length > 0) {
    lines.push(`- 已拆解故事：${stories.map((s) => `[${s.status}] ${s.title}`).join('；')}`);
    const handoffs = stories
      .filter((story) => story.status === 'done')
      .map((story) => ensureStoryHandoff(story.id))
      .filter((handoff): handoff is Handoff => Boolean(handoff));
    for (const handoff of handoffs) lines.push(formatHandoff(handoff));
  }
  const children = listRequirements(requirement.projectId).filter((r) => r.parentRequirementId === requirement.id);
  if (children.length > 0) {
    lines.push(`- 子需求：${children.map((r) => `[${r.status}] ${r.title}`).join('；')}`);
  }
  return lines.filter(Boolean).join('\n');
}

export function requirementDependencyContext(requirementId: string): string {
  const requirement = getRequirement(requirementId);
  const predecessors = listDependencies(requirement.projectId, 'requirement')
    .filter((d) => d.successorId === requirementId)
    .map((d) => getRequirement(d.predecessorId));
  if (predecessors.length === 0) return '';
  const blocks = predecessors
    .filter((item) => requirementDelivered(item.id))
    .map(requirementContextBlock);
  if (blocks.length === 0) return '';
  return ['## 前置需求交付上下文（可作为本次需求的输入）', ...blocks].join('\n').slice(0, MAX_CONTEXT_CHARS);
}

export function storyDependencyContext(storyId: string): string {
  const story = getStory(storyId);
  const deps = listDependencies(story.projectId, 'story').filter((d) => d.successorId === storyId);
  const blocks: string[] = [];
  for (const dep of deps) {
    const predecessor = getStory(dep.predecessorId);
    if (predecessor.status !== 'done') continue;
    const handoff = ensureStoryHandoff(predecessor.id);
    if (handoff) {
      blocks.push(formatHandoff(handoff));
      continue;
    }
    const dod = dodItemsForStory(predecessor.id)
      .filter((item) => item.command && item.status === 'pass')
      .map((item) => item.label);
    const acceptance = acceptanceForStory(predecessor.id)
      .filter((item) => item.status === 'pass')
      .map((item) => `${item.acId}: ${item.then}`);
    blocks.push(
      [
        `### 前置故事：${predecessor.title}`,
        predecessor.description ? `- 说明：${truncate(predecessor.description, 600)}` : '',
        predecessor.acceptanceCriteria ? `- 验收标准：${truncate(predecessor.acceptanceCriteria, 500)}` : '',
        dod.length ? `- 已验证门禁：${dod.join('；')}` : '',
        acceptance.length ? `- 已验证行为：${acceptance.join('；')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (story.requirementId) {
    const reqDeps = listDependencies(story.projectId, 'requirement').filter(
      (d) => d.successorId === story.requirementId,
    );
    for (const dep of reqDeps) {
      const predecessor = getRequirement(dep.predecessorId);
      if (!requirementDelivered(predecessor.id)) continue;
      blocks.push(requirementContextBlock(predecessor));
    }
  }
  if (blocks.length === 0) return '';
  return ['## 前置交付上下文（已完成，可复用其契约与决策）', ...blocks].join('\n').slice(0, MAX_CONTEXT_CHARS);
}

export function buildDependencyGraph(
  projectId: string,
  type: DependencyEntityType,
  opts: { requirementId?: string | null } = {},
): DependencyGraph {
  const nodes: DependencyGraphNode[] = [];
  const edges: DependencyGraphEdge[] = [];
  const dependencyEdges = listDependencies(projectId, type);
  const idSet = new Set<string>();

  if (type === 'requirement') {
    let requirements = listRequirements(projectId).filter((r) => r.status !== 'archived');
    if (opts.requirementId) {
      const root = requirements.find((r) => r.id === opts.requirementId);
      requirements = root ? [root, ...requirements.filter((r) => r.parentRequirementId === root.id)] : requirements;
    }
    for (const requirement of requirements) {
      idSet.add(requirement.id);
      nodes.push({
        id: requirement.id,
        type: 'requirement',
        title: requirement.title,
        status: requirement.status,
        categoryId: requirement.categoryId,
        parentId: requirement.parentRequirementId,
        depth: requirementDepth(requirement.id),
        blockedBy: requirementBlockers(requirement.id).map((item) => item.id),
      });
    }
    for (const requirement of requirements) {
      if (requirement.parentRequirementId && idSet.has(requirement.parentRequirementId)) {
        edges.push({ from: requirement.parentRequirementId, to: requirement.id, kind: 'containment' });
      }
    }
  } else {
    let stories = listStories(projectId);
    if (opts.requirementId) stories = stories.filter((s) => s.requirementId === opts.requirementId);
    for (const story of stories) {
      idSet.add(story.id);
      const info = storyDependencyInfo(story.id);
      nodes.push({
        id: story.id,
        type: 'story',
        title: story.title,
        status: story.status,
        categoryId: story.categoryId,
        parentId: story.requirementId,
        depth: 1,
        blockedBy: info.blockedBy.map((item) => item.id),
      });
    }
  }

  for (const edge of dependencyEdges) {
    if (!idSet.has(edge.predecessorId) || !idSet.has(edge.successorId)) continue;
    edges.push({ from: edge.predecessorId, to: edge.successorId, kind: 'dependency' });
  }

  return { nodes, edges, cycles: findCycles(nodes.map((n) => n.id), edges.filter((e) => e.kind === 'dependency')) };
}

function findCycles(nodeIds: string[], edges: DependencyGraphEdge[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const id of nodeIds) graph.set(id, []);
  for (const edge of edges) graph.get(edge.from)?.push(edge.to);
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const visit = (id: string): void => {
    const current = state.get(id) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(start >= 0 ? start : 0).concat(id);
      const key = [...cycle].sort().join('|');
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        cycles.push(cycle);
      }
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id) ?? []) visit(next);
    stack.pop();
    state.set(id, 2);
  };
  for (const id of nodeIds) visit(id);
  return cycles;
}

