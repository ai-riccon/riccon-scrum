import type { FlowMetrics, QualityMetrics, RequirementMetrics } from '@riccon-scrum/shared';
import { eventsForStory, listRequirements, listRequirementVersions, listStories } from './db';

export function computeMetrics(projectId?: string): FlowMetrics {
  const stories = listStories(projectId);
  const done = stories.filter((s) => s.status === 'done');
  const inProgress = stories.filter((s) => s.status === 'in_dev').length;
  const blocked = stories.filter((s) => s.status === 'blocked').length;

  const leadTimes = done
    .map((s) => new Date(s.updatedAt).getTime() - new Date(s.createdAt).getTime())
    .filter((n) => n >= 0);
  const avgLeadTimeMs = leadTimes.length ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;

  let cycleSum = 0;
  let cycleN = 0;
  let reworkCount = 0;
  let everBlocked = 0;
  for (const s of stories) {
    const evs = eventsForStory(s.id);
    let readyTs: string | null = null;
    let doneTs: string | null = null;
    let blockedFlag = false;
    for (const e of evs) {
      if (e.payload.type !== 'story.status') continue;
      const p = e.payload;
      if (p.to === 'ready' && !readyTs) readyTs = e.ts;
      if (p.to === 'done') doneTs = e.ts;
      if (p.to === 'blocked') blockedFlag = true;
      if (p.from === 'review' && p.to === 'in_dev') reworkCount++;
    }
    if (readyTs && doneTs) {
      cycleSum += new Date(doneTs).getTime() - new Date(readyTs).getTime();
      cycleN++;
    }
    if (blockedFlag) everBlocked++;
  }
  const finished = done.length + everBlocked;

  return {
    throughput: done.length,
    done: done.length,
    inProgress,
    blocked,
    avgLeadTimeMs,
    avgCycleTimeMs: cycleN ? cycleSum / cycleN : null,
    changeFailRate: finished ? everBlocked / finished : null,
    reworkCount,
  };
}

export function computeQualityMetrics(projectId?: string): QualityMetrics {
  const stories = listStories(projectId);
  const accepted = stories.filter((s) => s.status === 'done');
  let acceptedWithoutRework = 0;
  let reworkCount = 0;
  let reviewSum = 0;
  let reviewN = 0;
  let acceptedTokens = 0;
  for (const story of stories) {
    const events = eventsForStory(story.id);
    let maxTokens = 0;
    let reviewStart: number | null = null;
    let doneAt: number | null = null;
    let reworked = false;
    for (const event of events) {
      const payload = event.payload;
      if (payload.type === 'usage') maxTokens = Math.max(maxTokens, payload.tokens);
      if (payload.type === 'story.status') {
        if (payload.to === 'review' && reviewStart === null) reviewStart = new Date(event.ts).getTime();
        if (payload.to === 'done') doneAt = new Date(event.ts).getTime();
        if (payload.from === 'review' && payload.to === 'in_dev') {
          reworked = true;
          reworkCount++;
        }
      }
    }
    if (story.status === 'done') {
      acceptedTokens += maxTokens;
      if (!reworked) acceptedWithoutRework++;
      if (reviewStart !== null && doneAt !== null && doneAt >= reviewStart) {
        reviewSum += doneAt - reviewStart;
        reviewN++;
      }
    }
  }
  return {
    accepted: accepted.length,
    acceptedWithoutRework,
    firstPassAcceptanceRate: accepted.length ? acceptedWithoutRework / accepted.length : null,
    avgReviewMs: reviewN ? reviewSum / reviewN : null,
    totalTokens: acceptedTokens,
    avgTokensPerAccepted: accepted.length ? acceptedTokens / accepted.length : null,
    reworkCount,
  };
}

export function computeRequirementMetrics(projectId?: string): RequirementMetrics {
  const requirements = listRequirements(projectId).filter((r) => r.status !== 'archived');
  let versioned = 0;
  let versionsTotal = 0;
  let firstPass = 0;
  let cycleSum = 0;
  let cycleN = 0;
  for (const requirement of requirements) {
    const versions = listRequirementVersions(requirement.id);
    if (versions.length > 0) {
      versioned++;
      versionsTotal += versions.length;
      if (!versions[0].issues.some((i) => i.severity === 'error')) firstPass++;
    }
    if (['approved', 'decomposed'].includes(requirement.status)) {
      const elapsed = new Date(requirement.updatedAt).getTime() - new Date(requirement.createdAt).getTime();
      if (elapsed >= 0) {
        cycleSum += elapsed;
        cycleN++;
      }
    }
  }
  const materialized = listStories(projectId).filter((s) => s.requirementId);
  const coverage = materialized.length
    ? materialized.filter((s) => (s.sourceClause ?? '').trim()).length / materialized.length
    : null;
  return {
    total: requirements.length,
    decomposed: requirements.filter((r) => r.status === 'decomposed').length,
    inReview: requirements.filter((r) => ['in_review', 'revising', 'clarifying'].includes(r.status)).length,
    avgVersions: versioned ? versionsTotal / versioned : 0,
    firstPassRate: versioned ? firstPass / versioned : null,
    avgCycleMs: cycleN ? cycleSum / cycleN : null,
    feedbackRounds: versioned ? Math.max(0, (versionsTotal - versioned) / versioned) : 0,
    coverage,
    materializedStories: materialized.length,
  };
}