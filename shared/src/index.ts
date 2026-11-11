export type StoryStatus = 'draft' | 'ready' | 'in_dev' | 'review' | 'done' | 'blocked';

export const STORY_FLOW: Record<StoryStatus, StoryStatus[]> = {
  draft: ['ready', 'blocked'],
  ready: ['in_dev', 'draft', 'blocked'],
  in_dev: ['review', 'blocked', 'ready'],
  review: ['done', 'in_dev', 'blocked'],
  done: [],
  blocked: ['draft', 'ready', 'in_dev'],
};

export interface DodCommand {
  kind: 'test' | 'build' | 'lint' | 'custom';
  label: string;
  command: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  repoPath: string;
  defaultBranch: string;
  dodCommands: DodCommand[];
  agentKind: string;
  teamMode: boolean;
  createdAt: string;
}

export interface Story {
  id: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  status: StoryStatus;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DodStatus = 'pending' | 'pass' | 'fail' | 'skipped';

export interface DodItem {
  id: string;
  storyId: string;
  kind: string;
  label: string;
  command: string | null;
  status: DodStatus;
  evidence: string | null;
  updatedAt: string;
}

export type SessionStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'error';

export type AgentRole = 'solo' | 'lead' | 'dev' | 'qa';

export interface AgentSession {
  id: string;
  storyId: string;
  agentKind: string;
  role: AgentRole;
  acpSessionId: string | null;
  pid: number | null;
  status: SessionStatus;
  createdAt: string;
}

export type ApprovalKind = 'permission' | 'plan' | 'accept' | 'merge' | 'conflict';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface Approval {
  id: string;
  storyId: string;
  sessionId: string | null;
  kind: ApprovalKind;
  title: string;
  requestJson: string;
  status: ApprovalStatus;
  optionId: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export type TeamPhase = 'plan' | 'implement' | 'verify' | 'gate';

export interface TeamPlanTask {
  id: string;
  title: string;
  files: string[];
}

export interface TeamVerdict {
  pass: boolean;
  issues: string[];
}

export interface TeamRun {
  id: string;
  storyId: string;
  phase: TeamPhase;
  plan: TeamPlanTask[];
  verdict: TeamVerdict | null;
  turns: number;
  tokens: number;
  startedAt: string;
  updatedAt: string;
}

export type EventPayload =
  | { type: 'story.status'; from: StoryStatus; to: StoryStatus }
  | { type: 'agent.message'; sessionId: string; role: 'agent' | 'user' | 'thought'; text: string }
  | {
      type: 'agent.tool';
      sessionId: string;
      toolCallId: string;
      title: string;
      kind: string | null;
      status: string;
      locations: string[];
    }
  | { type: 'agent.plan'; sessionId: string; entries: PlanEntry[] }
  | { type: 'session.status'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'approval.requested'; approval: Approval }
  | { type: 'approval.decided'; approval: Approval }
  | { type: 'dod.result'; itemId: string; status: DodStatus; evidence: string }
  | { type: 'team.phase'; phase: TeamPhase; role: AgentRole; sessionId: string }
  | { type: 'team.plan'; tasks: TeamPlanTask[] }
  | { type: 'team.verdict'; verdict: TeamVerdict }
  | { type: 'usage'; sessionId: string; tokens: number }
  | { type: 'budget.exceeded'; kind: 'turns' | 'time' | 'tokens'; detail: string }
  | { type: 'conflict.detected'; otherStoryId: string; otherTitle: string; files: string[] };

export interface EventRow {
  seq: number;
  storyId: string;
  type: EventPayload['type'];
  payload: EventPayload;
  ts: string;
}

export interface ApiError {
  error: string;
}

export interface ProjectProfile {
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  scripts: Record<string, string>;
  testCommands: string[];
  buildCommands: string[];
  entryPoints: string[];
  structure: string[];
  dependencies: string[];
  manifests: string[];
}

export interface BaselineResult {
  command: string;
  ok: boolean;
  output: string;
}

export type OnboardStatus = 'idle' | 'scanning' | 'analyzing' | 'baselining' | 'done' | 'error';

export interface ProjectProfileRecord {
  projectId: string;
  status: OnboardStatus;
  profile: ProjectProfile | null;
  architecture: string | null;
  baseline: BaselineResult[];
  error: string | null;
  updatedAt: string;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface CodeSearchResult {
  path: string;
  line: number;
  kind: 'symbol' | 'content' | 'file';
  name: string;
  snippet: string;
}

export interface CodeIndexStats {
  files: number;
  symbols: number;
  indexedAt: string | null;
}

export interface FlowMetrics {
  throughput: number;
  done: number;
  inProgress: number;
  blocked: number;
  avgLeadTimeMs: number | null;
  avgCycleTimeMs: number | null;
  changeFailRate: number | null;
  reworkCount: number;
}