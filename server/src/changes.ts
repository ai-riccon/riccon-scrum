import type {
  ChangeDecision,
  ChangeImpactAction,
  ChangeMetrics,
  Requirement,
  RequirementChangeRequest,
  RequirementChangeSource,
  RequirementChangeStatus,
  RequirementChangeType,
  StoryStatus,
} from '@riccon-scrum/shared';
import { bus } from './bus';
import { generateRequirementDocuments } from './documents';
import {
  changeMetrics as computeChangeMetrics,
  createChangeRequest,
  createRequirement,
  getChangeRequest,
  getRequirement,
  listChangeRequests,
  listStories,
  updateChangeRequest,
} from './db';

const ALLOWED_TYPES: RequirementChangeType[] = ['corrective', 'adaptive', 'perfective'];
const ALLOWED_SOURCES: RequirementChangeSource[] = ['production', 'review', 'bug', 'manual', 'external'];

function assertChangeType(type: string): RequirementChangeType {
  if (!ALLOWED_TYPES.includes(type as RequirementChangeType)) throw new Error(`未知的变更类型：${type}`);
  return type as RequirementChangeType;
}

function assertSource(source: string): RequirementChangeSource {
  if (!ALLOWED_SOURCES.includes(source as RequirementChangeSource)) throw new Error(`未知的反馈来源：${source}`);
  return source as RequirementChangeSource;
}

function impactForStatus(status: StoryStatus, type: RequirementChangeType): { action: ChangeImpactAction; recommendation: string } {
  if (status === 'draft' || status === 'ready') {
    return { action: 'adjust', recommendation: '未开始，可直接按变更调整故事范围与 AC' };
  }
  if (status === 'in_dev' || status === 'review') {
    return { action: 'rework', recommendation: '进行中，建议人工决定返工或拆分增量故事' };
  }
  if (status === 'done') {
    return type === 'perfective' || type === 'adaptive'
      ? { action: 'add_increment', recommendation: '已交付，建议派生增量故事，不覆盖已完成交付' }
      : { action: 'add_regression', recommendation: '已交付，建议新增修复/回归故事并保留原有交付' };
  }
  return { action: 'keep', recommendation: '阻塞中，需先处理阻塞原因再决定处置方式' };
}

export function createRequirementChangeRequest(input: {
  requirementId: string;
  title: string;
  reason: string;
  changeType: RequirementChangeType;
  source: RequirementChangeSource;
  iteration?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
}): RequirementChangeRequest {
  const requirement = getRequirement(input.requirementId);
  if (!['approved', 'decomposed'].includes(requirement.status)) {
    throw new Error(`需求状态 ${requirement.status} 不允许发起迭代反馈`);
  }
  if (!input.title?.trim()) throw new Error('请填写变更标题');
  if (!input.reason?.trim()) throw new Error('请填写变更原因与期望结果');
  const changeRequest = createChangeRequest({
    projectId: requirement.projectId,
    requirementId: requirement.id,
    baselineVersion: requirement.approvedVersion ?? requirement.currentVersion,
    changeType: assertChangeType(input.changeType),
    source: assertSource(input.source),
    title: input.title.trim(),
    reason: input.reason.trim(),
    iteration: input.iteration ?? null,
    externalId: input.externalId ?? null,
    externalUrl: input.externalUrl ?? null,
  });
  bus.publish(changeRequest.id, {
    type: 'change.requested',
    changeRequestId: changeRequest.id,
    requirementId: requirement.id,
    changeType: changeRequest.changeType,
    impact: 0,
  });
  return changeRequest;
}

export function analyzeChangeRequest(id: string): RequirementChangeRequest {
  const changeRequest = getChangeRequest(id);
  if (!['draft', 'in_review'].includes(changeRequest.status)) {
    throw new Error(`变更单状态 ${changeRequest.status} 不允许重新分析`);
  }
  const requirement = getRequirement(changeRequest.requirementId);
  const stories = listStories(requirement.projectId).filter((story) => story.requirementId === requirement.id);
  const impact = stories.map((story) => {
    const decision = impactForStatus(story.status, changeRequest.changeType);
    return {
      storyId: story.id,
      title: story.title,
      status: story.status,
      recommendation: decision.recommendation,
      action: decision.action,
    };
  });
  const from = changeRequest.status;
  if (from === 'draft') {
    updateChangeRequest(id, { status: 'analyzing' });
    bus.publish(id, {
      type: 'change.status',
      changeRequestId: id,
      requirementId: requirement.id,
      from: 'draft',
      to: 'analyzing',
    });
  }
  const analyzed = updateChangeRequest(id, { status: 'in_review', impact });
  bus.publish(id, {
    type: 'change.status',
    changeRequestId: id,
    requirementId: requirement.id,
    from: 'analyzing',
    to: 'in_review',
  });
  bus.publish(id, {
    type: 'change.requested',
    changeRequestId: id,
    requirementId: requirement.id,
    changeType: changeRequest.changeType,
    impact: impact.length,
  });
  return analyzed;
}

export function decideChangeRequest(
  id: string,
  input: { status: 'approved' | 'rejected'; decision?: ChangeDecision | null; decidedBy?: string },
): RequirementChangeRequest {
  const changeRequest = getChangeRequest(id);
  if (changeRequest.status !== 'in_review') throw new Error(`变更单状态 ${changeRequest.status} 不允许决策`);
  if (input.status === 'approved') {
    if (!input.decision) throw new Error('批准变更单需要选择 revision/increment');
    if (!['revision', 'increment'].includes(input.decision)) throw new Error('不支持的变更决策');
  }
  const next = updateChangeRequest(id, {
    status: input.status,
    decision: input.status === 'approved' ? input.decision ?? null : null,
    decidedBy: input.decidedBy?.trim() || 'human',
  });
  bus.publish(id, {
    type: 'change.status',
    changeRequestId: id,
    requirementId: changeRequest.requirementId,
    from: 'in_review',
    to: input.status,
  });
  return next;
}

export function materializeChangeRequest(id: string): { changeRequest: RequirementChangeRequest; requirement: Requirement } {
  const changeRequest = getChangeRequest(id);
  if (changeRequest.status !== 'approved') throw new Error(`变更单状态 ${changeRequest.status} 不允许物化`);
  if (!changeRequest.decision) throw new Error('变更单尚未选择决策');
  const original = getRequirement(changeRequest.requirementId);
  const derived = createRequirement({
    projectId: original.projectId,
    title: changeRequest.title,
    rawInput: [
      `[需求迭代/${changeRequest.changeType}/${changeRequest.decision}]`,
      `基线需求：${original.title}（v${changeRequest.baselineVersion}）`,
      `变更原因：${changeRequest.reason}`,
    ].join('\n'),
    source: 'change_request',
    derivedFromRequirementId: original.id,
    changeRequestId: changeRequest.id,
    categoryId: original.categoryId,
  });
  const next = updateChangeRequest(id, {
    status: 'materialized',
    derivedRequirementId: derived.id,
  });
  bus.publish(id, {
    type: 'change.status',
    changeRequestId: id,
    requirementId: original.id,
    from: 'approved',
    to: 'materialized',
  });
  bus.publish(id, {
    type: 'change.materialized',
    changeRequestId: id,
    requirementId: original.id,
    derivedRequirementId: derived.id,
    stories: 0,
  });
  try {
    generateRequirementDocuments(original.projectId);
  } catch (err) {
    console.error('[documents] requirement docs failed after change', err);
  }
  return { changeRequest: next, requirement: derived };
}

export function listRequirementChangeRequests(projectId?: string, requirementId?: string): RequirementChangeRequest[] {
  return listChangeRequests({ projectId, requirementId });
}

export function updateImpactAction(
  changeRequestId: string,
  storyId: string,
  action: ChangeImpactAction,
): RequirementChangeRequest {
  const changeRequest = getChangeRequest(changeRequestId);
  if (['materialized', 'archived'].includes(changeRequest.status)) throw new Error('已物化或归档的变更单不能修改影响动作');
  const impact = changeRequest.impact.map((item) =>
    item.storyId === storyId
      ? {
          ...item,
          action,
          recommendation:
            action === 'keep'
              ? '保持原状'
              : action === 'adjust'
                ? '按变更调整范围与 AC'
                : action === 'rework'
                  ? '退回当前故事返工'
                  : action === 'add_regression'
                    ? '新增修复/回归故事'
                    : '派生增量故事',
        }
      : item,
  );
  return updateChangeRequest(changeRequestId, { impact });
}

export function changeMetrics(projectId?: string, iteration?: string): ChangeMetrics {
  return computeChangeMetrics(projectId, iteration);
}

export function changeStatusLabel(status: RequirementChangeStatus): string {
  return status;
}
