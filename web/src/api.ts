import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSession, Approval, CodeIndexStats, CodeSearchResult, DodItem, EventRow, FlowMetrics, Project, ProjectProfileRecord, Story, TeamRun } from '@acp-scrum/shared';

export type BoardStory = Story & { dod: DodItem[] };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  projects: () => req<Project[]>('/projects'),
  createProject: (b: { name: string; repoPath: string; defaultBranch?: string; agentKind?: string; teamMode?: boolean }) =>
    req<Project>('/projects', { method: 'POST', body: JSON.stringify(b) }),
  stories: () => req<BoardStory[]>('/stories'),
  storyDetail: (id: string) => req<{ story: Story; dod: import('@acp-scrum/shared').DodItem[]; sessions: import('@acp-scrum/shared').AgentSession[] }>(`/stories/${id}`),
  storyDiff: (id: string) => req<{ diff: string }>(`/stories/${id}/diff`),
  team: (id: string) => req<{ run: TeamRun | null; sessions: AgentSession[] }>(`/stories/${id}/team`),
  updateSettings: (id: string, patch: { agentKind?: string; teamMode?: boolean }) =>
    req<Project>(`/projects/${id}/settings`, { method: 'POST', body: JSON.stringify(patch) }),
  profile: (id: string) => req<ProjectProfileRecord>(`/projects/${id}/profile`),
  onboard: (id: string) => req<{ status: string }>(`/projects/${id}/onboard`, { method: 'POST', body: '{}' }),
  index: (id: string) => req<CodeIndexStats>(`/projects/${id}/index`, { method: 'POST', body: '{}' }),
  indexStats: (id: string) => req<{ files: number; symbols: number }>(`/projects/${id}/index`),
  search: (id: string, q: string) => req<CodeSearchResult[]>(`/projects/${id}/search?q=${encodeURIComponent(q)}`),
  metrics: (projectId?: string) => req<FlowMetrics>(`/metrics${projectId ? `?projectId=${projectId}` : ''}`),
  approvals: (status?: string) => req<Approval[]>(`/approvals${status ? `?status=${status}` : ''}`),
  events: (afterSeq: number) => req<EventRow[]>(`/events?afterSeq=${afterSeq}`),
  createStory: (b: { projectId: string; title: string; description: string; acceptanceCriteria: string }) =>
    req<Story>('/stories', { method: 'POST', body: JSON.stringify(b) }),
  action: (id: string, action: 'approve' | 'start' | 'rework' | 'accept') =>
    req<unknown>(`/stories/${id}/${action}`, { method: 'POST', body: '{}' }),
  resume: (id: string, message: string) =>
    req<unknown>(`/stories/${id}/resume`, { method: 'POST', body: JSON.stringify({ message }) }),
  decide: (id: string, status: 'approved' | 'denied', optionId?: string) =>
    req<Approval>(`/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify({ status, optionId }) }),
};

export interface LiveState {
  projects: Project[];
  stories: BoardStory[];
  approvals: Approval[];
  events: EventRow[];
  connected: boolean;
  refresh: () => Promise<void>;
}

export function useLiveData(onEvent?: (e: EventRow) => void): LiveState {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stories, setStories] = useState<BoardStory[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const refresh = useCallback(async () => {
    const [p, s, a] = await Promise.all([api.projects(), api.stories(), api.approvals('pending')]);
    setProjects(p);
    setStories(s);
    setApprovals(a);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?afterSeq=${lastSeq.current}`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (msg) => {
        const row = JSON.parse(msg.data) as EventRow;
        if (row.seq <= lastSeq.current) return;
        lastSeq.current = row.seq;
        setEvents((prev) => [...prev.slice(-799), row]);
        onEventRef.current?.(row);
        if (row.type === 'story.status' || row.type.startsWith('approval.') || row.type === 'dod.result') {
          refresh().catch(console.error);
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [refresh]);

  return { projects, stories, approvals, events, connected, refresh };
}