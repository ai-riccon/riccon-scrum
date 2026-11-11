import type { FlowMetrics } from '@acp-scrum/shared';
import { eventsForStory, listStories } from './db';

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