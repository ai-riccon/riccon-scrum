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

export interface PolicyGate {
  label: string;
  command: string;
  blocking: boolean;
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
  model: string;
  discoveryModel: string;
  glossary: string;
  releaseCommand: string;
  rollbackCommand: string;
  contractCommand: string;
  policyGates: PolicyGate[];
  requireMachineDod: boolean;
  autoApproveReads: boolean;
  autoApproveCommands: string[];
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
  requirementId: string | null;
  categoryId: string | null;
  bugId: string | null;
  sourceStoryId: string | null;
  changeRequestId: string | null;
  tags?: Tag[];
  sourceVersion: number | null;
  sourceVersionId: string | null;
  sourceStoryKey: string | null;
  sourceClause: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaxonomySource = 'manual' | 'ai';

export interface Tag {
  id: string;
  projectId: string;
  name: string;
  color: string;
  source?: TaxonomySource;
  status?: 'active' | 'pending' | 'merged';
  createdAt: string;
}

export interface Category {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  path: string;
  depth: number;
  sort: number;
  source?: TaxonomySource;
  status?: 'active' | 'pending' | 'merged';
  createdAt: string;
}

export interface TaxonomyCategoryNode {
  name: string;
  children?: TaxonomyCategoryNode[];
}

export interface TaxonomyTagProposal {
  name: string;
  color?: string;
}

export interface TaxonomyAssignment {
  entityType: DependencyEntityType;
  entityId: string;
  entityTitle?: string;
  categoryPath?: string;
  tags?: string[];
  confidence?: number;
  reason?: string;
}

export interface TaxonomyProposal {
  summary: string;
  categories: TaxonomyCategoryNode[];
  tags: TaxonomyTagProposal[];
  assignments: TaxonomyAssignment[];
  model: string | null;
}

export interface EntitySearchHit {
  type: 'requirement' | 'story';
  id: string;
  title: string;
  snippet: string;
  status: string;
  categoryId: string | null;
  tags: string[];
  requirementId: string | null;
  score: number;
}

export interface EntitySearchResult {
  mode: 'lexical' | 'hybrid';
  hits: EntitySearchHit[];
}

export type DependencyEntityType = 'requirement' | 'story';

export interface Dependency {
  id: string;
  projectId: string;
  predecessorType: DependencyEntityType;
  predecessorId: string;
  successorType: DependencyEntityType;
  successorId: string;
  kind: 'finish_to_start';
  note: string | null;
  createdAt: string;
}

export interface DependencyGraphNode {
  id: string;
  type: DependencyEntityType;
  title: string;
  status: string;
  categoryId: string | null;
  parentId: string | null;
  depth: number;
  blockedBy: string[];
}

export interface DependencyGraphEdge {
  from: string;
  to: string;
  kind: 'dependency' | 'containment';
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  cycles: string[][];
}

export interface DependencyItem {
  id: string;
  title: string;
  status: string;
  type: DependencyEntityType;
}

export interface DependencySuggestion {
  predecessorType: DependencyEntityType;
  predecessorId: string;
  predecessorTitle: string;
  successorType: DependencyEntityType;
  successorId: string;
  successorTitle: string;
  reason: string;
  confidence: number;
}

export interface StoryDependencyInfo {
  predecessors: DependencyItem[];
  successors: DependencyItem[];
  blockedBy: DependencyItem[];
}

export type StoryTaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
export type StoryTaskSource = 'ai' | 'manual' | 'fallback';
export type TaskPlanReview = 'never' | 'risky' | 'always';

export interface StoryTask {
  id: string;
  projectId: string;
  storyId: string;
  seq: number;
  key: string;
  title: string;
  description: string;
  files: string[];
  acIds: string[];
  verifyCommand: string | null;
  status: StoryTaskStatus;
  attempts: number;
  evidence: string | null;
  sessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  tokens: number;
  source: StoryTaskSource;
  createdAt: string;
  updatedAt: string;
}

export interface StoryTaskDraft {
  key: string;
  title: string;
  description: string;
  files: string[];
  acIds: string[];
  dependsOn: string[];
  verifyCommand?: string | null;
}

export interface StoryTaskEdge {
  taskId: string;
  dependsOnTaskId: string;
}

export interface StoryTaskPlan {
  storyId: string;
  strategy: string;
  model: string | null;
  source: StoryTaskSource;
  tasks: StoryTask[];
  edges: StoryTaskEdge[];
  criticalPath: string[];
  parallel: boolean;
}

export interface StoryTaskSummary {
  storyId: string;
  total: number;
  done: number;
  failed: number;
  currentKey: string | null;
  currentTitle: string | null;
  tokens: number;
}

export interface StoryTaskMetrics {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  firstPassRate: number | null;
  avgAttempts: number | null;
  avgCycleMs: number | null;
  tokens: number;
}

export interface TaskPlanIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  taskKey?: string | null;
}

export interface RequirementSplitChild {
  key: string;
  title: string;
  goal: string;
  scope: string;
  acceptance: string[];
  dependsOn: string[];
  size: string;
}

export interface RequirementSplitDraft {
  requirementId: string;
  version: number;
  summary: string;
  children: RequirementSplitChild[];
  model: string | null;
  createdAt: string;
}

export interface HandoffFile {
  path: string;
  added: number;
  removed: number;
  risk: 'high' | 'medium' | 'low';
}

export interface Handoff {
  id: string;
  projectId: string;
  entityType: DependencyEntityType;
  entityId: string;
  title: string;
  summary: string;
  files: HandoffFile[];
  contracts: string | null;
  migrations: string[];
  dod: string[];
  acceptance: string[];
  decisions: string[];
  createdAt: string;
}

export type RequirementStatus =
  | 'intake'
  | 'clarifying'
  | 'drafting'
  | 'in_review'
  | 'revising'
  | 'approved'
  | 'decomposed'
  | 'split'
  | 'blocked'
  | 'archived';

export const REQUIREMENT_FLOW: Record<RequirementStatus, RequirementStatus[]> = {
  intake: ['clarifying', 'drafting', 'archived'],
  clarifying: ['drafting', 'revising', 'split', 'blocked', 'archived'],
  drafting: ['clarifying', 'in_review', 'blocked', 'archived'],
  in_review: ['revising', 'approved', 'split', 'blocked', 'archived'],
  revising: ['clarifying', 'in_review', 'blocked', 'archived'],
  approved: ['decomposed', 'blocked', 'archived'],
  decomposed: ['archived'],
  split: ['archived'],
  blocked: ['intake', 'drafting', 'in_review', 'archived'],
  archived: [],
};

export interface RequirementIntake {
  goal: string;
  users: string;
  constraints: string;
  nonGoals: string;
  successMetrics: string;
  examples: string;
}

export interface RequirementAcceptanceCriterion {
  id: string;
  given: string;
  when: string;
  then: string;
  test?: string;
}

export type AcceptanceStatus = 'pending' | 'pass' | 'fail';

export interface StoryAcceptance {
  id: string;
  storyId: string;
  acId: string;
  given: string;
  when: string;
  then: string;
  test: string | null;
  status: AcceptanceStatus;
  evidence: string | null;
  updatedAt: string;
}

export interface RequirementStoryDraft {
  key: string;
  title: string;
  persona: string;
  value: string;
  description: string;
  acceptance: RequirementAcceptanceCriterion[];
  dod: string[];
  size: string;
  dependsOn: string[];
  clauses: string[];
  outOfScope: string[];
}

export interface RequirementDraft {
  summary: string;
  goals: string[];
  nonGoals: string[];
  personas: string[];
  assumptions: string[];
  openQuestions: string[];
  categoryPath?: string;
  tags?: string[];
  stories: RequirementStoryDraft[];
}

export type RequirementIssueSeverity = 'error' | 'warn';

export interface RequirementIssue {
  severity: RequirementIssueSeverity;
  code: string;
  message: string;
  storyKey?: string | null;
}

export interface Requirement {
  id: string;
  projectId: string;
  title: string;
  rawInput: string;
  intake: RequirementIntake | null;
  source: string;
  parentRequirementId: string | null;
  changeRequestId: string | null;
  derivedFromRequirementId: string | null;
  categoryId: string | null;
  tags?: Tag[];
  status: RequirementStatus;
  currentVersion: number;
  approvedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export type RequirementChangeType = 'corrective' | 'adaptive' | 'perfective';
export type RequirementChangeSource = 'production' | 'review' | 'bug' | 'manual' | 'external';
export type RequirementChangeStatus =
  | 'draft'
  | 'analyzing'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'materialized'
  | 'archived';
export type ChangeDecision = 'revision' | 'increment' | 'story_delta';
export type ChangeImpactAction = 'keep' | 'adjust' | 'rework' | 'add_increment' | 'add_regression';

export interface ChangeImpactItem {
  storyId: string;
  title: string;
  status: StoryStatus;
  recommendation: string;
  action?: ChangeImpactAction;
}

export interface RequirementChangeRequest {
  id: string;
  projectId: string;
  requirementId: string;
  baselineVersion: number;
  changeType: RequirementChangeType;
  source: RequirementChangeSource;
  title: string;
  reason: string;
  status: RequirementChangeStatus;
  impact: ChangeImpactItem[];
  decision: ChangeDecision | null;
  derivedRequirementId: string | null;
  iteration: string | null;
  externalId: string | null;
  externalUrl: string | null;
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeMetrics {
  total: number;
  approved: number;
  rejected: number;
  materialized: number;
  avgCycleMs: number | null;
  impactStories: number;
}

export type BugSeverity = 'blocker' | 'critical' | 'major' | 'minor';
export type BugPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type BugReproducibility = 'always' | 'often' | 'sometimes' | 'once';
export type BugStatus =
  | 'new'
  | 'triaged'
  | 'accepted'
  | 'rejected'
  | 'duplicate'
  | 'fixing'
  | 'fixed'
  | 'verified'
  | 'closed'
  | 'reopened';

export interface BugReport {
  id: string;
  projectId: string;
  storyId: string;
  requirementId: string | null;
  acIds: string[];
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  environment: string;
  evidence: string[];
  severity: BugSeverity;
  priority: BugPriority;
  reproducibility: BugReproducibility;
  status: BugStatus;
  duplicateOf: string | null;
  triageNote: string | null;
  fixStoryId: string | null;
  regressionTest: string | null;
  rootCause: string | null;
  resolution: string | null;
  reporter: string;
  reopenCount: number;
  slaDueAt: string | null;
  externalId: string | null;
  externalUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BugDuplicateCandidate {
  bugId: string;
  title: string;
  status: BugStatus;
  severity: BugSeverity;
  score: number;
}

export interface BugTriageSuggestion {
  severity: BugSeverity;
  priority: BugPriority;
  reproducibility: BugReproducibility;
  acIds: string[];
  duplicateCandidates: BugDuplicateCandidate[];
  summary: string;
  source: 'ai' | 'heuristic';
}

export interface BugMetrics {
  total: number;
  open: number;
  fixed: number;
  closed: number;
  rejected: number;
  duplicate: number;
  overdue: number;
  mttrMs: number | null;
  reopenRate: number | null;
  bySeverity: Record<BugSeverity, number>;
}

export type KnowledgeKind = 'adr' | 'standard' | 'failure';

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementVersion {
  id: string;
  requirementId: string;
  version: number;
  draft: RequirementDraft | null;
  issues: RequirementIssue[];
  model: string | null;
  createdAt: string;
}

export type RequirementFeedbackDecision = 'approve' | 'reject' | 'comment' | 'edit';

export interface RequirementFeedback {
  id: string;
  requirementId: string;
  version: number;
  storyKey: string | null;
  decision: RequirementFeedbackDecision;
  comment: string | null;
  decidedBy: string;
  createdAt: string;
}

export type RequirementMessageRole = 'user' | 'agent';

export interface RequirementMessage {
  id: string;
  requirementId: string;
  role: RequirementMessageRole;
  content: string;
  ready: boolean;
  createdAt: string;
}

export interface RequirementConversation {
  messages: RequirementMessage[];
  ready: boolean;
  running: boolean;
}

export interface RequirementDetail {
  requirement: Requirement;
  versions: RequirementVersion[];
  feedback: RequirementFeedback[];
  conversation: RequirementConversation;
}

export interface RequirementMetrics {
  total: number;
  decomposed: number;
  inReview: number;
  avgVersions: number;
  firstPassRate: number | null;
  avgCycleMs: number | null;
  feedbackRounds: number;
  coverage: number | null;
  materializedStories: number;
}

export type RequirementJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RequirementJob {
  requirementId: string;
  status: RequirementJobStatus;
  startedAt: string;
  heartbeatAt: string;
  cancelRequested: boolean;
  error: string | null;
}

export type ReleaseStatus = 'running' | 'succeeded' | 'failed' | 'rolled_back' | 'rollback_failed';

export interface Release {
  id: string;
  storyId: string;
  projectId: string;
  status: ReleaseStatus;
  command: string;
  output: string | null;
  releasedBy: string;
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
  blocking: boolean;
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
  model: string | null;
  acpSessionId: string | null;
  pid: number | null;
  status: SessionStatus;
  createdAt: string;
}

export interface GlobalSettings {
  wipLimit: number;
  maxTurns: number;
  maxWallMs: number;
  maxTokens: number;
  idleReapMs: number;
  defaultAgentKind: string;
  requireMachineDod: boolean;
  embeddingUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  taskPlanning: boolean;
  maxStoryTasks: number;
  maxTaskAttempts: number;
  taskPlanReview: TaskPlanReview;
  parallelTasks: boolean;
  maxParallelTasks: number;
  taskContextChars: number;
  bugSlaDays: number;
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
  dependsOn?: string[];
  acIds?: string[];
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
  | { type: 'acceptance.result'; acceptanceId: string; acId: string; storyId: string; status: AcceptanceStatus; evidence: string }
  | { type: 'release.result'; storyId: string; releaseId: string; status: ReleaseStatus; evidence: string }
  | { type: 'contract.result'; storyId: string; ok: boolean; evidence: string }
  | { type: 'team.phase'; phase: TeamPhase; role: AgentRole; sessionId: string }
  | { type: 'team.plan'; tasks: TeamPlanTask[] }
  | { type: 'team.verdict'; verdict: TeamVerdict }
  | { type: 'usage'; sessionId: string; tokens: number }
  | { type: 'budget.exceeded'; kind: 'turns' | 'time' | 'tokens'; detail: string }
  | { type: 'requirement.status'; requirementId: string; from: RequirementStatus; to: RequirementStatus }
  | { type: 'requirement.draft'; requirementId: string; version: number; stories: number; issues: number; model: string | null }
  | { type: 'requirement.feedback'; requirementId: string; version: number; storyKey: string | null; decision: RequirementFeedbackDecision }
  | { type: 'requirement.materialized'; requirementId: string; version: number; storyIds: string[] }
  | { type: 'requirement.chat'; requirementId: string; role: RequirementMessageRole; ready: boolean }
  | { type: 'requirement.split'; requirementId: string; children: number }
  | { type: 'task.plan'; storyId: string; tasks: number; criticalPath: string[]; model: string | null }
  | {
      type: 'task.status';
      storyId: string;
      taskId: string;
      taskKey: string;
      from: StoryTaskStatus;
      to: StoryTaskStatus;
      evidence?: string;
    }
  | { type: 'task.verify'; storyId: string; taskId: string; taskKey: string; ok: boolean; evidence: string }
  | {
      type: 'change.requested';
      changeRequestId: string;
      requirementId: string;
      changeType: RequirementChangeType;
      impact: number;
    }
  | {
      type: 'change.status';
      changeRequestId: string;
      requirementId: string;
      from: RequirementChangeStatus;
      to: RequirementChangeStatus;
    }
  | {
      type: 'change.materialized';
      changeRequestId: string;
      requirementId: string;
      derivedRequirementId: string | null;
      stories: number;
    }
  | { type: 'bug.reported'; bugId: string; storyId: string; severity: BugSeverity; priority: BugPriority }
  | { type: 'bug.status'; bugId: string; storyId: string; from: BugStatus; to: BugStatus }
  | { type: 'bug.fix_created'; bugId: string; storyId: string; fixStoryId: string }
  | { type: 'document.generated'; documentId: string; docType: DocumentType; slug: string; version: number; status: DocumentStatus }
  | { type: 'document.status'; documentId: string; docType: DocumentType; slug: string; from: DocumentStatus; to: DocumentStatus }
  | { type: 'document.synced'; projectId: string; written: number; conflicts: number }
  | { type: 'dependency.override'; storyId: string; predecessors: string[]; reason: string }
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

export type DocumentType =
  | 'overview'
  | 'requirements'
  | 'architecture'
  | 'coding-standards'
  | 'code-graph'
  | 'database'
  | 'api-contract'
  | 'test-strategy'
  | 'operations'
  | 'security';

export type DocumentStatus = 'draft' | 'published' | 'stale' | 'error' | 'archived';
export type DocumentSource = 'onboard' | 'requirement' | 'manual' | 'regenerate' | 'import';
export type DocumentJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type DocumentSyncStatus = 'new' | 'modified' | 'unchanged' | 'conflict';
export type DocumentStage = 'requirement' | 'planning' | 'execution' | 'qa';

export interface ProjectDocument {
  id: string;
  projectId: string;
  docType: DocumentType;
  slug: string;
  title: string;
  status: DocumentStatus;
  content: string;
  summary: string;
  version: number;
  source: DocumentSource;
  sourceCommit: string | null;
  generatedBy: string | null;
  model: string | null;
  autoUpdate: boolean;
  watchedGlobs: string[];
  pinned: boolean;
  checksum: string;
  error: string | null;
  lastGeneratedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDocumentSummary {
  id: string;
  projectId: string;
  docType: DocumentType;
  slug: string;
  title: string;
  status: DocumentStatus;
  summary: string;
  version: number;
  source: DocumentSource;
  sourceCommit: string | null;
  autoUpdate: boolean;
  pinned: boolean;
  sectionCount: number;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  content: string;
  summary: string;
  sourceCommit: string | null;
  model: string | null;
  createdBy: string;
  createdAt: string;
}

export interface DocumentSection {
  id: string;
  documentId: string;
  version: number;
  anchor: string;
  heading: string;
  headingPath: string;
  ordinal: number;
  content: string;
  tokens: number;
}

export interface DocumentRef {
  documentId: string;
  docType: DocumentType;
  slug: string;
  title: string;
  version: number;
  status: DocumentStatus;
  anchor: string | null;
  heading: string | null;
}

export interface DocumentContext {
  text: string;
  refs: DocumentRef[];
  chars: number;
}

export interface DocumentJob {
  projectId: string;
  docType: DocumentType;
  slug: string;
  status: DocumentJobStatus;
  startedAt: string;
  heartbeatAt: string;
  cancelRequested: boolean;
  error: string | null;
}

export interface DocumentSyncEntry {
  documentId: string;
  docType: DocumentType;
  slug: string;
  title: string;
  version: number;
  targetPath: string;
  status: DocumentSyncStatus;
  contentChecksum: string;
  fileChecksum: string | null;
}

export interface DocumentSyncPreview {
  projectId: string;
  targetDir: string;
  entries: DocumentSyncEntry[];
  summary: { new: number; modified: number; unchanged: number; conflict: number };
}

export interface DocumentSyncResult extends DocumentSyncPreview {
  written: number;
  skipped: number;
}

export interface DocumentMetrics {
  total: number;
  published: number;
  draft: number;
  stale: number;
  error: number;
  synced: number;
  autoUpdate: number;
  pinned: number;
  byType: Record<DocumentType, number>;
}

export interface DocumentConsistencyIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  documentId: string | null;
  docType: DocumentType | null;
  slug: string | null;
  ref: string | null;
}

export interface DocumentImpact {
  documentId: string;
  docType: DocumentType;
  slug: string;
  title: string;
  version: number;
  status: DocumentStatus;
  reason: string;
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

export interface QualityMetrics {
  accepted: number;
  acceptedWithoutRework: number;
  firstPassAcceptanceRate: number | null;
  avgReviewMs: number | null;
  totalTokens: number;
  avgTokensPerAccepted: number | null;
  reworkCount: number;
}