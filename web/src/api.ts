import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentSession,
  Approval,
  Category,
  ChangeImpactItem,
  CodeIndexStats,
  Dependency,
  DependencyGraph,
  DependencyGraphNode,
  Handoff,
  Tag,
  CodeSearchResult,
  DodCommand,
  DodItem,
  EventRow,
  FlowMetrics,
  GlobalSettings,
  KnowledgeEntry,
  KnowledgeKind,
  Project,
  ProjectProfileRecord,
  QualityMetrics,
  Release,
  Requirement,
  RequirementDetail,
  RequirementFeedbackDecision,
  RequirementIntake,
  RequirementJob,
  RequirementMetrics,
  RequirementSplitChild,
  RequirementSplitDraft,
  Story,
  TaxonomyProposal,
  EntitySearchResult,
  DependencySuggestion,
  StoryAcceptance,
  StoryDependencyInfo,
  StoryTask,
  StoryTaskMetrics,
  StoryTaskPlan,
  StoryTaskSummary,
  TeamRun,
  RequirementChangeRequest,
  ChangeMetrics,
  BugReport,
  BugMetrics,
  BugTriageSuggestion,
  BugSeverity,
  BugPriority,
  BugReproducibility,
  DocumentConsistencyIssue,
  DocumentImpact,
  DocumentJob,
  DocumentMetrics,
  DocumentSection,
  DocumentSyncPreview,
  DocumentSyncResult,
  DocumentType,
  DocumentVersion,
  ProjectDocument,
  ProjectDocumentSummary,
  GitRepoState,
  DirListing,
} from '@riccon-scrum/shared';

export type DocumentLive = {
  document: ProjectDocument;
  sections: DocumentSection[];
  versions: DocumentVersion[];
  sync: { targetPath: string; checksum: string; syncedAt: string } | null;
  job: DocumentJob | null;
};

export type BoardStory = Story & {
  dod: DodItem[];
  acceptance: StoryAcceptance[];
  tasks?: StoryTaskSummary | null;
};
export type RequirementLive = RequirementDetail & {
  generating: boolean;
  job: RequirementJob | null;
  children?: Requirement[];
  dependencies?: Dependency[];
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  projects: (includeArchived = false) => req<Project[]>(`/projects${includeArchived ? '?includeArchived=1' : ''}`),
  createProject: (b: {
    name: string;
    repoPath: string;
    agentKind?: string;
    teamMode?: boolean;
    model?: string;
    discoveryModel?: string;
    glossary?: string;
    releaseCommand?: string;
    rollbackCommand?: string;
    contractCommand?: string;
    policyGates?: { label: string; command: string; blocking: boolean }[];
    requireMachineDod?: boolean;
    autoApproveReads?: boolean;
    autoApproveCommands?: string[];
  }) => req<Project>('/projects', { method: 'POST', body: JSON.stringify(b) }),
  projectGit: (id: string) => req<GitRepoState>(`/projects/${id}/git`),
  initProjectRepo: (id: string) => req<GitRepoState>(`/projects/${id}/git/init`, { method: 'POST', body: '{}' }),
  checkoutBranch: (id: string, branch: string) =>
    req<GitRepoState>(`/projects/${id}/git/checkout`, { method: 'POST', body: JSON.stringify({ branch }) }),
  archiveProject: (id: string) => req<Project>(`/projects/${id}/archive`, { method: 'POST', body: '{}' }),
  unarchiveProject: (id: string) => req<Project>(`/projects/${id}/unarchive`, { method: 'POST', body: '{}' }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  fsDirs: (dirPath?: string) => req<DirListing>(`/fs/dirs${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`),
  stories: () => req<BoardStory[]>('/stories'),
  requirements: (projectId?: string) => req<Requirement[]>(`/requirements${projectId ? `?projectId=${projectId}` : ''}`),
  requirementMetrics: (projectId?: string) =>
    req<RequirementMetrics>(`/requirements/metrics${projectId ? `?projectId=${projectId}` : ''}`),
  requirement: (id: string) => req<RequirementLive>(`/requirements/${id}`),
  createRequirement: (b: { projectId: string; title: string; rawInput: string; intake?: Partial<RequirementIntake> }) =>
    req<Requirement>('/requirements', { method: 'POST', body: JSON.stringify(b) }),
  startIntake: (b: { projectId: string; message: string }) =>
    req<Requirement>('/requirements/intake', { method: 'POST', body: JSON.stringify(b) }),
  intakeMessage: (id: string, message: string) =>
    req<{ message: unknown }>(`/requirements/${id}/intake`, { method: 'POST', body: JSON.stringify({ message }) }),
  confirmIntake: (id: string) =>
    req<{ status: string }>(`/requirements/${id}/intake/confirm`, { method: 'POST', body: '{}' }),
  createFeedback: (b: { projectId: string; title: string; description: string; severity?: string }) =>
    req<Requirement>('/feedback', { method: 'POST', body: JSON.stringify(b) }),
  changeRequest: (id: string, b: { title: string; rawInput: string }) =>
    req<{ requirement: Requirement; impact: ChangeImpactItem[] }>(`/requirements/${id}/change-request`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  requirementChangeRequests: (id: string) => req<RequirementChangeRequest[]>(`/requirements/${id}/change-requests`),
  createRequirementChangeRequest: (
    id: string,
    b: {
      title: string;
      reason: string;
      changeType: 'corrective' | 'adaptive' | 'perfective';
      source?: 'production' | 'review' | 'bug' | 'manual' | 'external';
      iteration?: string | null;
      externalId?: string | null;
      externalUrl?: string | null;
    },
  ) => req<RequirementChangeRequest>(`/requirements/${id}/change-requests`, { method: 'POST', body: JSON.stringify(b) }),
  changeRequests: (projectId?: string, status?: string, iteration?: string) =>
    req<RequirementChangeRequest[]>(
      `/change-requests${projectId ? `?projectId=${projectId}` : ''}${status ? `${projectId ? '&' : '?'}status=${status}` : ''}${iteration ? `${projectId || status ? '&' : '?'}iteration=${encodeURIComponent(iteration)}` : ''}`,
    ),
  getChangeRequest: (id: string) => req<RequirementChangeRequest>(`/change-requests/${id}`),
  analyzeChangeRequest: (id: string) =>
    req<RequirementChangeRequest>(`/change-requests/${id}/analyze`, { method: 'POST', body: '{}' }),
  decideChangeRequest: (id: string, b: { status: 'approved' | 'rejected'; decision?: 'revision' | 'increment' }) =>
    req<RequirementChangeRequest>(`/change-requests/${id}/decide`, { method: 'POST', body: JSON.stringify(b) }),
  materializeChangeRequest: (id: string) =>
    req<{ changeRequest: RequirementChangeRequest; requirement: Requirement }>(`/change-requests/${id}/materialize`, {
      method: 'POST',
      body: '{}',
    }),
  updateChangeImpact: (id: string, storyId: string, action: 'keep' | 'adjust' | 'rework' | 'add_increment' | 'add_regression') =>
    req<RequirementChangeRequest>(`/change-requests/${id}/impact/${storyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),
  changeMetrics: (projectId?: string, iteration?: string) =>
    req<ChangeMetrics>(`/metrics/changes${projectId ? `?projectId=${projectId}${iteration ? `&iteration=${encodeURIComponent(iteration)}` : ''}` : ''}`),
  generateRequirement: (id: string) => req<{ status: string }>(`/requirements/${id}/generate`, { method: 'POST', body: '{}' }),
  cancelRequirement: (id: string) => req<RequirementJob | null>(`/requirements/${id}/cancel`, { method: 'POST', body: '{}' }),
  requirementFeedback: (
    id: string,
    b: {
      comment?: string;
      decisions?: { storyKey?: string | null; decision: RequirementFeedbackDecision; comment?: string }[];
    },
  ) => req<{ feedback: unknown[]; status: string }>(`/requirements/${id}/feedback`, { method: 'POST', body: JSON.stringify(b) }),
  approveRequirement: (id: string) =>
    req<{ requirement: Requirement; stories: Story[]; version: number }>(`/requirements/${id}/approve`, { method: 'POST', body: '{}' }),
  archiveRequirement: (id: string) => req<Requirement>(`/requirements/${id}/archive`, { method: 'POST', body: '{}' }),
  splitDraft: (id: string) => req<RequirementSplitDraft | null>(`/requirements/${id}/split/draft`),
  generateSplitDraft: (id: string) =>
    req<RequirementSplitDraft>(`/requirements/${id}/split/draft`, { method: 'POST', body: '{}' }),
  confirmSplit: (id: string, children: RequirementSplitChild[]) =>
    req<{ parent: Requirement; children: Requirement[] }>(`/requirements/${id}/split/confirm`, {
      method: 'POST',
      body: JSON.stringify({ children }),
    }),
  categories: (projectId: string) => req<Category[]>(`/categories?projectId=${projectId}`),
  tags: (projectId: string) => req<Tag[]>(`/tags?projectId=${projectId}`),
  taxonomyPreview: (projectId: string) =>
    req<TaxonomyProposal>('/taxonomy/preview', { method: 'POST', body: JSON.stringify({ projectId }) }),
  taxonomyApply: (projectId: string, proposal: TaxonomyProposal) =>
    req<{ categoriesCreated: number; tagsCreated: number; assignmentsApplied: number }>('/taxonomy/apply', {
      method: 'POST',
      body: JSON.stringify({ projectId, proposal }),
    }),
  createTag: (b: { projectId: string; name: string; color?: string }) =>
    req<Tag>('/tags', { method: 'POST', body: JSON.stringify(b) }),
  deleteTag: (id: string) => req<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
  setRequirementTags: (id: string, tagIds: string[]) =>
    req<Tag[]>(`/requirements/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) }),
  setStoryTags: (id: string, tagIds: string[]) =>
    req<Tag[]>(`/stories/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) }),
  createCategory: (b: { projectId: string; name: string; parentId?: string | null }) =>
    req<Category>('/categories', { method: 'POST', body: JSON.stringify(b) }),
  renameCategory: (id: string, name: string) =>
    req<Category>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => req<{ ok: boolean }>(`/categories/${id}`, { method: 'DELETE' }),
  setRequirementCategory: (id: string, categoryId: string | null) =>
    req<Requirement>(`/requirements/${id}/category`, { method: 'PUT', body: JSON.stringify({ categoryId }) }),
  setStoryCategory: (id: string, categoryId: string | null) =>
    req<Story>(`/stories/${id}/category`, { method: 'PUT', body: JSON.stringify({ categoryId }) }),
  dependencies: (projectId: string, type?: 'requirement' | 'story') =>
    req<Dependency[]>(`/dependencies?projectId=${projectId}${type ? `&type=${type}` : ''}`),
  createDependency: (b: {
    projectId: string;
    predecessorType: 'requirement' | 'story';
    predecessorId: string;
    successorType: 'requirement' | 'story';
    successorId: string;
    note?: string | null;
  }) => req<Dependency>('/dependencies', { method: 'POST', body: JSON.stringify(b) }),
  deleteDependency: (id: string) => req<{ ok: boolean }>(`/dependencies/${id}`, { method: 'DELETE' }),
  suggestDependencies: (b: { projectId: string; entityType: 'requirement' | 'story'; entityId: string }) =>
    req<DependencySuggestion[]>('/dependencies/suggest', { method: 'POST', body: JSON.stringify(b) }),
  graph: (projectId: string, type: 'requirement' | 'story', requirementId?: string | null) =>
    req<DependencyGraph>(
      `/graph?projectId=${projectId}&type=${type}${requirementId ? `&requirementId=${requirementId}` : ''}`,
    ),
  storyDependencies: (id: string) => req<StoryDependencyInfo>(`/stories/${id}/dependencies`),
  storyHandoff: (id: string) => req<Handoff | null>(`/stories/${id}/handoff`),
  storyBugs: (id: string) => req<BugReport[]>(`/stories/${id}/bugs`),
  createBug: (
    storyId: string,
    b: {
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
  ) => req<BugReport>(`/stories/${storyId}/bugs`, { method: 'POST', body: JSON.stringify(b) }),
  bugs: (projectId?: string, status?: string, storyId?: string) =>
    req<BugReport[]>(
      `/bugs${projectId ? `?projectId=${projectId}` : ''}${status ? `${projectId ? '&' : '?'}status=${status}` : ''}${storyId ? `${projectId || status ? '&' : '?'}storyId=${storyId}` : ''}`,
    ),
  bug: (id: string) => req<BugReport>(`/bugs/${id}`),
  suggestBug: (id: string) => req<BugTriageSuggestion>(`/bugs/${id}/suggest`),
  triageBug: (
    id: string,
    b: {
      severity?: BugSeverity;
      priority?: BugPriority;
      reproducibility?: BugReproducibility;
      acIds?: string[];
      duplicateOf?: string | null;
      triageNote?: string | null;
    },
  ) => req<BugReport>(`/bugs/${id}/triage`, { method: 'POST', body: JSON.stringify(b) }),
  acceptBug: (id: string, b: { regressionTest?: string; strategy?: 'auto' | 'rework' | 'fix_story' }) =>
    req<{ mode: 'rework' | 'fix_story'; bug: BugReport; story: Story }>(`/bugs/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  rejectBug: (id: string, reason: string) =>
    req<BugReport>(`/bugs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  verifyBug: (id: string, resolution?: string) =>
    req<BugReport>(`/bugs/${id}/verify`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  closeBug: (id: string, resolution?: string) =>
    req<BugReport>(`/bugs/${id}/close`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  reopenBug: (id: string, reason: string) =>
    req<BugReport>(`/bugs/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
  bugMetrics: (projectId?: string) => req<BugMetrics>(`/metrics/bugs${projectId ? `?projectId=${projectId}` : ''}`),
  forceStartStory: (id: string, reason: string) =>
    req<{ story: Story }>(`/stories/${id}/start`, { method: 'POST', body: JSON.stringify({ override: true, reason }) }),
  storyDetail: (id: string) =>
    req<{
      story: Story;
      dod: DodItem[];
      acceptance: StoryAcceptance[];
      sessions: AgentSession[];
      dependencies: StoryDependencyInfo;
      taskPlan: StoryTaskPlan;
      bugs: BugReport[];
    }>(`/stories/${id}`),
  storyTasks: (id: string) => req<StoryTaskPlan>(`/stories/${id}/tasks`),
  planStoryTasks: (id: string, force = false) =>
    req<{ plan: StoryTaskPlan; fallback: boolean }>(`/stories/${id}/tasks/plan`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  replanStoryTasks: (id: string, failure = '') =>
    req<{ plan: StoryTaskPlan; fallback: boolean }>(`/stories/${id}/tasks/replan`, {
      method: 'POST',
      body: JSON.stringify({ failure }),
    }),
  updateStoryTask: (
    id: string,
    taskId: string,
    patch: {
      title?: string;
      description?: string;
      files?: string[];
      acIds?: string[];
      verifyCommand?: string | null;
      dependsOnKeys?: string[];
    },
  ) => req<StoryTaskPlan>(`/stories/${id}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  retryStoryTask: (id: string, taskId: string) =>
    req<StoryTask>(`/stories/${id}/tasks/${taskId}/retry`, { method: 'POST', body: '{}' }),
  skipStoryTask: (id: string, taskId: string, reason: string) =>
    req<StoryTask>(`/stories/${id}/tasks/${taskId}/skip`, { method: 'POST', body: JSON.stringify({ reason }) }),
  taskMetrics: (projectId?: string) =>
    req<StoryTaskMetrics>(`/metrics/tasks${projectId ? `?projectId=${projectId}` : ''}`),
  storyDiff: (id: string) => req<{ diff: string; files: { path: string; added: number; removed: number; risk: 'high' | 'medium' | 'low' }[]; risk: 'high' | 'medium' | 'low' }>(`/stories/${id}/diff`),
  releaseStatus: (id: string) => req<Release | null>(`/stories/${id}/release`),
  release: (id: string) => req<Release>(`/stories/${id}/release`, { method: 'POST', body: '{}' }),
  rollback: (id: string) => req<Release>(`/stories/${id}/rollback`, { method: 'POST', body: '{}' }),
  team: (id: string) =>
    req<{ run: TeamRun | null; sessions: AgentSession[]; tasks: StoryTaskPlan }>(`/stories/${id}/team`),
  settings: () => req<{ global: GlobalSettings; agentKinds: string[] }>('/settings'),
  updateGlobalSettings: (patch: Partial<GlobalSettings>) => req<GlobalSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  updateSettings: (
    id: string,
    patch: {
      agentKind?: string;
      teamMode?: boolean;
      model?: string;
      discoveryModel?: string;
      glossary?: string;
      releaseCommand?: string;
      rollbackCommand?: string;
      contractCommand?: string;
      policyGates?: { label: string; command: string; blocking: boolean }[];
      requireMachineDod?: boolean;
      autoApproveReads?: boolean;
      autoApproveCommands?: string[];
      dodCommands?: DodCommand[];
    },
  ) => req<Project>(`/projects/${id}/settings`, { method: 'POST', body: JSON.stringify(patch) }),
  profile: (id: string) => req<ProjectProfileRecord>(`/projects/${id}/profile`),
  onboard: (id: string) => req<{ status: string }>(`/projects/${id}/onboard`, { method: 'POST', body: '{}' }),
  documents: (projectId: string) => req<ProjectDocumentSummary[]>(`/projects/${projectId}/documents`),
  generateDocumentType: (projectId: string, docType: DocumentType) =>
    req<unknown>(`/projects/${projectId}/documents/${docType}/generate`, { method: 'POST', body: '{}' }),
  document: (id: string) => req<DocumentLive>(`/documents/${id}`),
  regenerateDocument: (id: string) =>
    req<{ status?: string } & Partial<ProjectDocument>>(`/documents/${id}/regenerate`, { method: 'POST', body: '{}' }),
  cancelDocument: (id: string) => req<DocumentJob>(`/documents/${id}/cancel`, { method: 'POST', body: '{}' }),
  updateDocument: (id: string, b: { content: string; title?: string }) =>
    req<ProjectDocument>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  publishDocument: (id: string) => req<ProjectDocument>(`/documents/${id}/publish`, { method: 'POST', body: '{}' }),
  pinDocument: (id: string, pinned: boolean) =>
    req<ProjectDocument>(`/documents/${id}/pinned`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  documentVersions: (id: string) => req<DocumentVersion[]>(`/documents/${id}/versions`),
  rollbackDocument: (id: string, version: number) =>
    req<ProjectDocument>(`/documents/${id}/rollback`, { method: 'POST', body: JSON.stringify({ version }) }),
  previewDocumentSync: (projectId: string, dir?: string) =>
    req<DocumentSyncPreview>(`/projects/${projectId}/documents/sync${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  applyDocumentSync: (projectId: string, b: { dir?: string; force?: boolean }) =>
    req<DocumentSyncResult>(`/projects/${projectId}/documents/sync`, { method: 'POST', body: JSON.stringify(b) }),
  refreshDocuments: (projectId: string) =>
    req<DocumentMetrics>(`/projects/${projectId}/documents/refresh`, { method: 'POST', body: '{}' }),
  documentMetrics: (projectId: string) => req<DocumentMetrics>(`/projects/${projectId}/documents/metrics`),
  documentConsistency: (projectId: string) =>
    req<DocumentConsistencyIssue[]>(`/projects/${projectId}/documents/consistency`),
  documentImpact: (projectId: string, requirementId: string) =>
    req<DocumentImpact[]>(`/projects/${projectId}/documents/impact?requirementId=${requirementId}`),
  index: (id: string) => req<CodeIndexStats>(`/projects/${id}/index`, { method: 'POST', body: '{}' }),
  indexStats: (id: string) => req<{ files: number; symbols: number }>(`/projects/${id}/index`),
  knowledge: (projectId: string) => req<KnowledgeEntry[]>(`/projects/${projectId}/knowledge`),
  addKnowledge: (projectId: string, b: { kind: KnowledgeKind; title: string; content: string; tags?: string }) =>
    req<KnowledgeEntry>(`/projects/${projectId}/knowledge`, { method: 'POST', body: JSON.stringify(b) }),
  deleteKnowledge: (id: string) => req<{ ok: boolean }>(`/knowledge/${id}`, { method: 'DELETE' }),
  search: (id: string, q: string) => req<CodeSearchResult[]>(`/projects/${id}/search?q=${encodeURIComponent(q)}`),
  searchEntities: (projectId: string, q: string) =>
    req<EntitySearchResult>(`/search/entities?projectId=${projectId}&q=${encodeURIComponent(q)}`),
  metrics: (projectId?: string) => req<FlowMetrics>(`/metrics${projectId ? `?projectId=${projectId}` : ''}`),
  qualityMetrics: (projectId?: string) =>
    req<QualityMetrics>(`/metrics/quality${projectId ? `?projectId=${projectId}` : ''}`),
  approvals: (status?: string) => req<Approval[]>(`/approvals${status ? `?status=${status}` : ''}`),
  events: (afterSeq: number) => req<EventRow[]>(`/events?afterSeq=${afterSeq}`),
  recentEvents: (limit = 800) => req<EventRow[]>(`/events/recent?limit=${limit}`),
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
  requirements: Requirement[];
  approvals: Approval[];
  events: EventRow[];
  connected: boolean;
  refresh: () => Promise<void>;
}

export function useLiveData(onEvent?: (e: EventRow) => void): LiveState {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stories, setStories] = useState<BoardStory[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const refresh = useCallback(async () => {
    const [p, s, r, a] = await Promise.all([api.projects(), api.stories(), api.requirements(), api.approvals('pending')]);
    setProjects(p);
    setStories(s);
    setRequirements(r);
    setApprovals(a);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let liveFrom = 0;
    let historySeeded = false;
    const mountedAt = new Date().toISOString();

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
        // Replayed history must not raise notifications; only events newer than load do.
        if (historySeeded ? row.seq > liveFrom : row.ts >= mountedAt) onEventRef.current?.(row);
        if (
          row.type === 'story.status' ||
          row.type.startsWith('approval.') ||
          row.type === 'dod.result' ||
          row.type === 'acceptance.result' ||
          row.type === 'release.result' ||
          row.type === 'contract.result' ||
          row.type.startsWith('requirement.') ||
          row.type.startsWith('task.') ||
          row.type.startsWith('change.') ||
          row.type.startsWith('bug.') ||
          row.type.startsWith('document.')
        ) {
          refresh().catch(console.error);
        }
      };
    };

    const boot = async () => {
      try {
        const recent = await api.recentEvents(800);
        if (closed) return;
        if (recent.length) {
          setEvents(recent);
          liveFrom = recent[recent.length - 1].seq;
          lastSeq.current = liveFrom;
        }
        historySeeded = true;
      } catch {
        // 拉取失败时仍连接，回放事件由时间戳过滤提醒
      }
      refresh().catch(console.error);
      if (!closed) connect();
    };
    void boot();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [refresh]);

  return { projects, stories, requirements, approvals, events, connected, refresh };
}