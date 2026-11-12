import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  REQUIREMENT_FLOW,
  STORY_FLOW,
  type AcceptanceStatus,
  type AgentRole,
  type AgentSession,
  type Approval,
  type ApprovalKind,
  type ApprovalStatus,
  type BaselineResult,
  type BugPriority,
  type BugReport,
  type BugReproducibility,
  type BugSeverity,
  type BugStatus,
  type BugMetrics,
  type Category,
  type ChangeDecision,
  type ChangeImpactItem,
  type ChangeMetrics,
  type CodeSymbol,
  type Dependency,
  type DependencyEntityType,
  type DodCommand,
  type DodItem,
  type DodStatus,
  type DocumentJob,
  type DocumentJobStatus,
  type DocumentSection,
  type DocumentSource,
  type DocumentStatus,
  type DocumentSyncStatus,
  type DocumentType,
  type DocumentVersion,
  type EventPayload,
  type EventRow,
  type Handoff,
  type HandoffFile,
  type KnowledgeEntry,
  type Tag,
  type KnowledgeKind,
  type OnboardStatus,
  type PolicyGate,
  type Project,
  type ProjectDocument,
  type ProjectDocumentSummary,
  type ProjectProfile,
  type ProjectProfileRecord,
  type Release,
  type ReleaseStatus,
  type Requirement,
  type RequirementChangeRequest,
  type RequirementChangeSource,
  type RequirementChangeStatus,
  type RequirementChangeType,
  type RequirementDraft,
  type RequirementFeedback,
  type RequirementFeedbackDecision,
  type RequirementIssue,
  type RequirementIntake,
  type RequirementJob,
  type RequirementJobStatus,
  type RequirementMessage,
  type RequirementMessageRole,
  type RequirementSplitDraft,
  type RequirementStatus,
  type RequirementVersion,
  type SessionStatus,
  type Story,
  type StoryAcceptance,
  type StoryStatus,
  type StoryTask,
  type StoryTaskDraft,
  type StoryTaskEdge,
  type StoryTaskMetrics,
  type StoryTaskSource,
  type StoryTaskStatus,
  type StoryTaskSummary,
  type TeamPhase,
  type TeamPlanTask,
  type TeamRun,
  type TeamVerdict,
} from '@riccon-scrum/shared';

const DATA_DIR = process.env.RICCON_DATA_DIR
  ? path.resolve(process.env.RICCON_DATA_DIR)
  : path.resolve(import.meta.dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const WORKTREES_DIR = path.join(DATA_DIR, 'worktrees');
fs.mkdirSync(WORKTREES_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  dod_commands TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  branch TEXT,
  worktree_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dod_items (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  command TEXT,
  blocking INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  evidence TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS story_acceptance (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  ac_id TEXT NOT NULL,
  given_text TEXT NOT NULL,
  when_text TEXT NOT NULL,
  then_text TEXT NOT NULL,
  test TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  evidence TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acceptance_story ON story_acceptance(story_id);
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  agent_kind TEXT NOT NULL DEFAULT 'opencode',
  acp_session_id TEXT,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'starting',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  session_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  option_id TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_story ON events(story_id, seq);
CREATE INDEX IF NOT EXISTS idx_stories_project ON stories(project_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE TABLE IF NOT EXISTS team_runs (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  phase TEXT NOT NULL DEFAULT 'plan',
  plan_json TEXT NOT NULL DEFAULT '[]',
  verdict_json TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS story_files (
  story_id TEXT NOT NULL REFERENCES stories(id),
  path TEXT NOT NULL,
  PRIMARY KEY (story_id, path)
);
CREATE TABLE IF NOT EXISTS project_profiles (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'idle',
  profile_json TEXT,
  architecture TEXT,
  baseline_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS code_index (
  project_id TEXT NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  symbols_json TEXT NOT NULL DEFAULT '[]',
  imports_json TEXT,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (project_id, path)
);
CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  doc_type TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  content TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  source_commit TEXT,
  generated_by TEXT,
  model TEXT,
  auto_update INTEGER NOT NULL DEFAULT 0,
  watched_globs TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  error TEXT,
  last_generated_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, doc_type, slug)
);
CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES project_documents(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source_commit TEXT,
  model TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  UNIQUE(document_id, version)
);
CREATE TABLE IF NOT EXISTS document_sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES project_documents(id),
  version INTEGER NOT NULL,
  anchor TEXT NOT NULL,
  heading TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS document_sync_state (
  document_id TEXT PRIMARY KEY REFERENCES project_documents(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  target_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_jobs (
  project_id TEXT NOT NULL REFERENCES projects(id),
  doc_type TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  PRIMARY KEY (project_id, doc_type, slug)
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON project_documents(project_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_document_sections_doc ON document_sections(document_id, version);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id, version);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  intake_json TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  parent_requirement_id TEXT,
  status TEXT NOT NULL DEFAULT 'intake',
  current_version INTEGER NOT NULL DEFAULT 0,
  approved_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirement_versions (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  version INTEGER NOT NULL,
  draft_json TEXT,
  issues_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (requirement_id, version)
);
CREATE TABLE IF NOT EXISTS requirement_feedback (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  version INTEGER NOT NULL,
  story_key TEXT,
  decision TEXT NOT NULL,
  comment TEXT,
  decided_by TEXT NOT NULL DEFAULT 'human',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirement_jobs (
  requirement_id TEXT PRIMARY KEY REFERENCES requirements(id),
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS requirement_messages (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  depth INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dependencies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  predecessor_type TEXT NOT NULL,
  predecessor_id TEXT NOT NULL,
  successor_type TEXT NOT NULL,
  successor_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'finish_to_start',
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (predecessor_type, predecessor_id, successor_type, successor_id)
);
CREATE TABLE IF NOT EXISTS requirement_split_drafts (
  requirement_id TEXT PRIMARY KEY REFERENCES requirements(id),
  version INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5b8cff',
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS entity_tags (
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (entity_type, entity_id, tag_id)
);
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  files_json TEXT NOT NULL DEFAULT '[]',
  contracts TEXT,
  migrations_json TEXT NOT NULL DEFAULT '[]',
  dod_json TEXT NOT NULL DEFAULT '[]',
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  decisions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'running',
  command TEXT NOT NULL,
  output TEXT,
  released_by TEXT NOT NULL DEFAULT 'human',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_requirement_versions_req ON requirement_versions(requirement_id, version);
CREATE INDEX IF NOT EXISTS idx_requirement_feedback_req ON requirement_feedback(requirement_id, version);
CREATE INDEX IF NOT EXISTS idx_requirement_messages_req ON requirement_messages(requirement_id, created_at);
CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_successor ON dependencies(successor_type, successor_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_predecessor ON dependencies(predecessor_type, predecessor_id);
CREATE TABLE IF NOT EXISTS story_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  story_id TEXT NOT NULL REFERENCES stories(id),
  seq INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  files_json TEXT NOT NULL DEFAULT '[]',
  ac_ids_json TEXT NOT NULL DEFAULT '[]',
  verify_command TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  evidence TEXT,
  session_id TEXT,
  worktree_path TEXT,
  branch TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (story_id, key)
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES story_tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES story_tasks(id),
  UNIQUE (task_id, depends_on_task_id)
);
CREATE TABLE IF NOT EXISTS story_task_plans (
  story_id TEXT PRIMARY KEY REFERENCES stories(id),
  project_id TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT '',
  model TEXT,
  source TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_story_tasks_story ON story_tasks(story_id, seq);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor ON task_dependencies(depends_on_task_id);
CREATE TABLE IF NOT EXISTS requirement_change_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  baseline_version INTEGER NOT NULL DEFAULT 0,
  change_type TEXT NOT NULL DEFAULT 'perfective',
  source TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  impact_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT,
  derived_requirement_id TEXT,
  iteration TEXT,
  external_id TEXT,
  external_url TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  story_id TEXT NOT NULL,
  requirement_id TEXT,
  ac_ids_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  actual TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL DEFAULT 'major',
  priority TEXT NOT NULL DEFAULT 'P2',
  reproducibility TEXT NOT NULL DEFAULT 'always',
  status TEXT NOT NULL DEFAULT 'new',
  duplicate_of TEXT,
  triage_note TEXT,
  fix_story_id TEXT,
  regression_test TEXT,
  root_cause TEXT,
  resolution TEXT,
  reporter TEXT NOT NULL DEFAULT 'human',
  reopen_count INTEGER NOT NULL DEFAULT 0,
  sla_due_at TEXT,
  external_id TEXT,
  external_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_requests_requirement ON requirement_change_requests(requirement_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_project ON requirement_change_requests(project_id, status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_story ON bug_reports(story_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_project ON bug_reports(project_id, status);
`);

function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('projects', 'agent_kind', "agent_kind TEXT NOT NULL DEFAULT 'opencode'");
ensureColumn('projects', 'team_mode', 'team_mode INTEGER NOT NULL DEFAULT 0');
ensureColumn('projects', 'model', "model TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'require_machine_dod', 'require_machine_dod INTEGER NOT NULL DEFAULT 1');
ensureColumn('projects', 'auto_approve_reads', 'auto_approve_reads INTEGER NOT NULL DEFAULT 1');
ensureColumn('projects', 'auto_approve_commands', "auto_approve_commands TEXT NOT NULL DEFAULT '[]'");
ensureColumn('projects', 'glossary', "glossary TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'discovery_model', "discovery_model TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'release_command', "release_command TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'rollback_command', "rollback_command TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'contract_command', "contract_command TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'policy_gates', "policy_gates TEXT NOT NULL DEFAULT '[]'");
ensureColumn('dod_items', 'blocking', 'blocking INTEGER NOT NULL DEFAULT 1');
ensureColumn('agent_sessions', 'role', "role TEXT NOT NULL DEFAULT 'solo'");
ensureColumn('agent_sessions', 'model', 'model TEXT');
ensureColumn('stories', 'requirement_id', 'requirement_id TEXT');
ensureColumn('stories', 'source_version', 'source_version INTEGER');
ensureColumn('stories', 'source_version_id', 'source_version_id TEXT');
ensureColumn('stories', 'source_story_key', 'source_story_key TEXT');
ensureColumn('stories', 'source_clause', 'source_clause TEXT');
ensureColumn('requirements', 'intake_json', 'intake_json TEXT');
ensureColumn('requirements', 'source', "source TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('requirements', 'parent_requirement_id', 'parent_requirement_id TEXT');
ensureColumn('requirements', 'category_id', 'category_id TEXT');
ensureColumn('stories', 'category_id', 'category_id TEXT');
ensureColumn('categories', 'source', "source TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('categories', 'status', "status TEXT NOT NULL DEFAULT 'active'");
ensureColumn('tags', 'source', "source TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('tags', 'status', "status TEXT NOT NULL DEFAULT 'active'");
ensureColumn('code_index', 'imports_json', 'imports_json TEXT');
ensureColumn('requirements', 'change_request_id', 'change_request_id TEXT');
ensureColumn('requirements', 'derived_from_requirement_id', 'derived_from_requirement_id TEXT');
ensureColumn('stories', 'bug_id', 'bug_id TEXT');
ensureColumn('stories', 'source_story_id', 'source_story_id TEXT');
ensureColumn('stories', 'change_request_id', 'change_request_id TEXT');

const now = () => new Date().toISOString();

function row<T>(r: Record<string, unknown> | undefined): T {
  if (!r) throw new Error('row not found');
  return r as T;
}

// ---- projects ----

export function createProject(input: {
  name: string;
  repoPath: string;
  defaultBranch?: string;
  dodCommands?: DodCommand[];
  agentKind?: string;
  teamMode?: boolean;
  model?: string;
  discoveryModel?: string;
  glossary?: string;
  releaseCommand?: string;
  rollbackCommand?: string;
  contractCommand?: string;
  policyGates?: PolicyGate[];
  requireMachineDod?: boolean;
  autoApproveReads?: boolean;
  autoApproveCommands?: string[];
}): Project {
  if (!input.name?.trim()) throw new Error('project name required');
  const repoPath = path.resolve(input.repoPath);
  if (!fs.existsSync(repoPath)) throw new Error(`repo path not found: ${repoPath}`);
  const p: Project = {
    id: randomUUID(),
    workspaceId: 'default',
    name: input.name.trim(),
    repoPath,
    defaultBranch: input.defaultBranch ?? 'main',
    dodCommands: input.dodCommands ?? [],
    agentKind: input.agentKind ?? 'opencode',
    teamMode: input.teamMode ?? false,
    model: input.model?.trim() ?? '',
    discoveryModel: input.discoveryModel?.trim() ?? '',
    glossary: input.glossary?.trim() ?? '',
    releaseCommand: input.releaseCommand?.trim() ?? '',
    rollbackCommand: input.rollbackCommand?.trim() ?? '',
    contractCommand: input.contractCommand?.trim() ?? '',
    policyGates: input.policyGates ?? [],
    requireMachineDod: input.requireMachineDod ?? true,
    autoApproveReads: input.autoApproveReads ?? true,
    autoApproveCommands: input.autoApproveCommands ?? [],
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO projects (id, workspace_id, name, repo_path, default_branch, dod_commands, agent_kind, team_mode, model, discovery_model, glossary, release_command, rollback_command, contract_command, policy_gates, require_machine_dod, auto_approve_reads, auto_approve_commands, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    p.id,
    p.workspaceId,
    p.name,
    p.repoPath,
    p.defaultBranch,
    JSON.stringify(p.dodCommands),
    p.agentKind,
    p.teamMode ? 1 : 0,
    p.model,
    p.discoveryModel,
    p.glossary,
    p.releaseCommand,
    p.rollbackCommand,
    p.contractCommand,
    JSON.stringify(p.policyGates),
    p.requireMachineDod ? 1 : 0,
    p.autoApproveReads ? 1 : 0,
    JSON.stringify(p.autoApproveCommands),
    p.createdAt,
  );
  return p;
}

export function getProject(id: string): Project {
  const r = row<Record<string, unknown>>(db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined);
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    name: r.name as string,
    repoPath: r.repo_path as string,
    defaultBranch: r.default_branch as string,
    dodCommands: JSON.parse(r.dod_commands as string) as DodCommand[],
    agentKind: (r.agent_kind as string) ?? 'opencode',
    teamMode: Boolean(r.team_mode),
    model: (r.model as string) ?? '',
    discoveryModel: (r.discovery_model as string) ?? '',
    glossary: (r.glossary as string) ?? '',
    releaseCommand: (r.release_command as string) ?? '',
    rollbackCommand: (r.rollback_command as string) ?? '',
    contractCommand: (r.contract_command as string) ?? '',
    policyGates: JSON.parse((r.policy_gates as string) ?? '[]') as PolicyGate[],
    requireMachineDod: r.require_machine_dod === undefined ? true : Boolean(r.require_machine_dod),
    autoApproveReads: r.auto_approve_reads === undefined ? true : Boolean(r.auto_approve_reads),
    autoApproveCommands: JSON.parse((r.auto_approve_commands as string) ?? '[]') as string[],
    createdAt: r.created_at as string,
  };
}

export function updateProjectSettings(
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
    policyGates?: PolicyGate[];
    requireMachineDod?: boolean;
    autoApproveReads?: boolean;
    autoApproveCommands?: string[];
    dodCommands?: DodCommand[];
  },
): Project {
  const cur = getProject(id);
  const agentKind = patch.agentKind ?? cur.agentKind;
  const teamMode = patch.teamMode ?? cur.teamMode;
  const model = patch.model !== undefined ? patch.model.trim() : cur.model;
  const discoveryModel = patch.discoveryModel !== undefined ? patch.discoveryModel.trim() : cur.discoveryModel;
  const glossary = patch.glossary !== undefined ? patch.glossary.trim() : cur.glossary;
  const releaseCommand = patch.releaseCommand !== undefined ? patch.releaseCommand.trim() : cur.releaseCommand;
  const rollbackCommand = patch.rollbackCommand !== undefined ? patch.rollbackCommand.trim() : cur.rollbackCommand;
  const contractCommand = patch.contractCommand !== undefined ? patch.contractCommand.trim() : cur.contractCommand;
  const policyGates = patch.policyGates ?? cur.policyGates;
  const requireMachineDod = patch.requireMachineDod ?? cur.requireMachineDod;
  const autoApproveReads = patch.autoApproveReads ?? cur.autoApproveReads;
  const autoApproveCommands = patch.autoApproveCommands ?? cur.autoApproveCommands;
  const dodCommands = patch.dodCommands ?? cur.dodCommands;
  db.prepare(
    'UPDATE projects SET agent_kind = ?, team_mode = ?, model = ?, discovery_model = ?, glossary = ?, release_command = ?, rollback_command = ?, contract_command = ?, policy_gates = ?, require_machine_dod = ?, auto_approve_reads = ?, auto_approve_commands = ?, dod_commands = ? WHERE id = ?',
  ).run(
    agentKind,
    teamMode ? 1 : 0,
    model,
    discoveryModel,
    glossary,
    releaseCommand,
    rollbackCommand,
    contractCommand,
    JSON.stringify(policyGates),
    requireMachineDod ? 1 : 0,
    autoApproveReads ? 1 : 0,
    JSON.stringify(autoApproveCommands.map((c) => c.trim()).filter(Boolean)),
    JSON.stringify(dodCommands),
    id,
  );
  return getProject(id);
}

export function listProjects(): Project[] {
  const rows = db.prepare('SELECT id FROM projects ORDER BY created_at').all() as { id: string }[];
  return rows.map((r) => getProject(r.id));
}

// ---- stories ----

function mapStory(r: Record<string, unknown>): Story {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    description: r.description as string,
    acceptanceCriteria: r.acceptance_criteria as string,
    status: r.status as StoryStatus,
    branch: (r.branch as string | null) ?? null,
    worktreePath: (r.worktree_path as string | null) ?? null,
    requirementId: (r.requirement_id as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? null,
    bugId: (r.bug_id as string | null) ?? null,
    sourceStoryId: (r.source_story_id as string | null) ?? null,
    changeRequestId: (r.change_request_id as string | null) ?? null,
    sourceVersion: (r.source_version as number | null) ?? null,
    sourceVersionId: (r.source_version_id as string | null) ?? null,
    sourceStoryKey: (r.source_story_key as string | null) ?? null,
    sourceClause: (r.source_clause as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createStory(input: {
  projectId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  requirementId?: string | null;
  bugId?: string | null;
  sourceStoryId?: string | null;
  changeRequestId?: string | null;
  sourceVersion?: number | null;
  sourceVersionId?: string | null;
  sourceStoryKey?: string | null;
  sourceClause?: string | null;
}): Story {
  const project = getProject(input.projectId);
  if (!input.title?.trim()) throw new Error('story title required');
  const s: Story = {
    id: randomUUID(),
    projectId: project.id,
    title: input.title.trim(),
    description: input.description ?? '',
    acceptanceCriteria: input.acceptanceCriteria ?? '',
    status: 'draft',
    branch: null,
    worktreePath: null,
    requirementId: input.requirementId ?? null,
    categoryId: null,
    bugId: input.bugId ?? null,
    sourceStoryId: input.sourceStoryId ?? null,
    changeRequestId: input.changeRequestId ?? null,
    sourceVersion: input.sourceVersion ?? null,
    sourceVersionId: input.sourceVersionId ?? null,
    sourceStoryKey: input.sourceStoryKey ?? null,
    sourceClause: input.sourceClause ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO stories (id, project_id, title, description, acceptance_criteria, status, branch, worktree_path, requirement_id, category_id, bug_id, source_story_id, change_request_id, source_version, source_version_id, source_story_key, source_clause, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    s.id,
    s.projectId,
    s.title,
    s.description,
    s.acceptanceCriteria,
    s.status,
    s.branch,
    s.worktreePath,
    s.requirementId,
    s.categoryId,
    s.bugId,
    s.sourceStoryId,
    s.changeRequestId,
    s.sourceVersion,
    s.sourceVersionId,
    s.sourceStoryKey,
    s.sourceClause,
    s.createdAt,
    s.updatedAt,
  );
  for (const cmd of project.dodCommands) {
    createDodItem(s.id, cmd.kind, cmd.label, cmd.command);
  }
  for (const gate of project.policyGates) {
    if (gate.command.trim()) createDodItem(s.id, 'policy', gate.label, gate.command, gate.blocking);
  }
  createDodItem(s.id, 'human', '人工验收（评审 diff + 验收标准）', null);
  return s;
}

export function getStory(id: string): Story {
  return mapStory(row<Record<string, unknown>>(db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function listStories(projectId?: string): Story[] {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM stories WHERE project_id = ? ORDER BY created_at').all(projectId)
      : db.prepare('SELECT * FROM stories ORDER BY created_at').all()
  ) as Record<string, unknown>[];
  return rows.map(mapStory);
}

export function setStoryStatus(id: string, to: StoryStatus): Story {
  const s = getStory(id);
  if (!STORY_FLOW[s.status].includes(to)) {
    throw new Error(`invalid transition: ${s.status} -> ${to}`);
  }
  db.prepare('UPDATE stories SET status = ?, updated_at = ? WHERE id = ?').run(to, now(), id);
  return getStory(id);
}

export function setStoryWorktree(id: string, branch: string, worktreePath: string): Story {
  db.prepare('UPDATE stories SET branch = ?, worktree_path = ?, updated_at = ? WHERE id = ?').run(branch, worktreePath, now(), id);
  return getStory(id);
}

// ---- story tasks ----

function jsonList<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mapStoryTask(r: Record<string, unknown>): StoryTask {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    storyId: r.story_id as string,
    seq: Number(r.seq),
    key: r.key as string,
    title: r.title as string,
    description: (r.description as string) ?? '',
    files: jsonList<string>(r.files_json),
    acIds: jsonList<string>(r.ac_ids_json),
    verifyCommand: (r.verify_command as string | null) ?? null,
    status: (r.status as StoryTaskStatus) ?? 'pending',
    attempts: Number(r.attempts ?? 0),
    evidence: (r.evidence as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    worktreePath: (r.worktree_path as string | null) ?? null,
    branch: (r.branch as string | null) ?? null,
    tokens: Number(r.tokens ?? 0),
    source: ((r.source as string) ?? 'ai') as StoryTaskSource,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createStoryTask(input: {
  projectId: string;
  storyId: string;
  seq?: number;
  key: string;
  title: string;
  description?: string;
  files?: string[];
  acIds?: string[];
  verifyCommand?: string | null;
  status?: StoryTaskStatus;
  source?: StoryTaskSource;
}): StoryTask {
  const task: StoryTask = {
    id: randomUUID(),
    projectId: input.projectId,
    storyId: input.storyId,
    seq: input.seq ?? 0,
    key: input.key,
    title: input.title,
    description: input.description ?? '',
    files: input.files ?? [],
    acIds: input.acIds ?? [],
    verifyCommand: input.verifyCommand ?? null,
    status: input.status ?? 'pending',
    attempts: 0,
    evidence: null,
    sessionId: null,
    worktreePath: null,
    branch: null,
    tokens: 0,
    source: input.source ?? 'ai',
    createdAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO story_tasks (id, project_id, story_id, seq, key, title, description, files_json, ac_ids_json, verify_command, status, attempts, evidence, session_id, worktree_path, branch, tokens, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    task.id,
    task.projectId,
    task.storyId,
    task.seq,
    task.key,
    task.title,
    task.description,
    JSON.stringify(task.files),
    JSON.stringify(task.acIds),
    task.verifyCommand,
    task.status,
    task.attempts,
    task.evidence,
    task.sessionId,
    task.worktreePath,
    task.branch,
    task.tokens,
    task.source,
    task.createdAt,
    task.updatedAt,
  );
  return task;
}

export function getStoryTask(id: string): StoryTask {
  return mapStoryTask(row<Record<string, unknown>>(db.prepare('SELECT * FROM story_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function listStoryTasks(storyId: string): StoryTask[] {
  const rows = db.prepare('SELECT * FROM story_tasks WHERE story_id = ? ORDER BY seq, created_at').all(storyId) as Record<string, unknown>[];
  return rows.map(mapStoryTask);
}

export function listTaskEdges(storyId: string): StoryTaskEdge[] {
  const rows = db
    .prepare(
      'SELECT d.task_id AS task_id, d.depends_on_task_id AS depends_on FROM task_dependencies d JOIN story_tasks t ON t.id = d.task_id WHERE t.story_id = ? ORDER BY t.seq',
    )
    .all(storyId) as { task_id: string; depends_on: string }[];
  return rows.map((r) => ({ taskId: r.task_id, dependsOnTaskId: r.depends_on }));
}

export function insertTaskDependency(taskId: string, dependsOnTaskId: string): void {
  db.prepare('INSERT OR IGNORE INTO task_dependencies (id, task_id, depends_on_task_id) VALUES (?, ?, ?)').run(
    randomUUID(),
    taskId,
    dependsOnTaskId,
  );
}

export function replaceTaskDependencies(taskId: string, dependsOnTaskIds: string[]): void {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(taskId);
  for (const dependency of dependsOnTaskIds) insertTaskDependency(taskId, dependency);
}

export function deleteStoryTask(taskId: string): void {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?').run(taskId, taskId);
  db.prepare('DELETE FROM story_tasks WHERE id = ?').run(taskId);
}

export function updateStoryTask(
  id: string,
  patch: {
    seq?: number;
    title?: string;
    description?: string;
    files?: string[];
    acIds?: string[];
    verifyCommand?: string | null;
    status?: StoryTaskStatus;
    attempts?: number;
    evidence?: string | null;
    sessionId?: string | null;
    worktreePath?: string | null;
    branch?: string | null;
    tokens?: number;
    source?: StoryTaskSource;
  },
): StoryTask {
  const cur = getStoryTask(id);
  const next = {
    seq: patch.seq ?? cur.seq,
    title: patch.title ?? cur.title,
    description: patch.description ?? cur.description,
    files: patch.files ?? cur.files,
    acIds: patch.acIds ?? cur.acIds,
    verifyCommand: patch.verifyCommand !== undefined ? patch.verifyCommand : cur.verifyCommand,
    status: patch.status ?? cur.status,
    attempts: patch.attempts ?? cur.attempts,
    evidence: patch.evidence !== undefined ? patch.evidence : cur.evidence,
    sessionId: patch.sessionId !== undefined ? patch.sessionId : cur.sessionId,
    worktreePath: patch.worktreePath !== undefined ? patch.worktreePath : cur.worktreePath,
    branch: patch.branch !== undefined ? patch.branch : cur.branch,
    tokens: patch.tokens !== undefined ? Math.max(cur.tokens, patch.tokens) : cur.tokens,
    source: patch.source ?? cur.source,
  };
  db.prepare(
    'UPDATE story_tasks SET seq = ?, title = ?, description = ?, files_json = ?, ac_ids_json = ?, verify_command = ?, status = ?, attempts = ?, evidence = ?, session_id = ?, worktree_path = ?, branch = ?, tokens = ?, source = ?, updated_at = ? WHERE id = ?',
  ).run(
    next.seq,
    next.title,
    next.description,
    JSON.stringify(next.files),
    JSON.stringify(next.acIds),
    next.verifyCommand,
    next.status,
    next.attempts,
    next.evidence,
    next.sessionId,
    next.worktreePath,
    next.branch,
    next.tokens,
    next.source,
    now(),
    id,
  );
  return getStoryTask(id);
}

export function deleteStoryTasks(storyId: string): void {
  const ids = listStoryTasks(storyId).map((task) => task.id);
  for (const id of ids) {
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?').run(id, id);
  }
  db.prepare('DELETE FROM story_tasks WHERE story_id = ?').run(storyId);
  db.prepare('DELETE FROM story_task_plans WHERE story_id = ?').run(storyId);
}

export function saveStoryTaskPlan(input: {
  storyId: string;
  projectId: string;
  strategy: string;
  model: string | null;
  source: StoryTaskSource;
}): void {
  const ts = now();
  db.prepare(
    'INSERT INTO story_task_plans (story_id, project_id, strategy, model, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(story_id) DO UPDATE SET strategy = excluded.strategy, model = excluded.model, source = excluded.source, updated_at = excluded.updated_at',
  ).run(input.storyId, input.projectId, input.strategy, input.model, input.source, ts, ts);
}

export function getStoryTaskPlanMeta(storyId: string): { strategy: string; model: string | null; source: StoryTaskSource } | null {
  const r = db.prepare('SELECT * FROM story_task_plans WHERE story_id = ?').get(storyId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    strategy: (r.strategy as string) ?? '',
    model: (r.model as string | null) ?? null,
    source: ((r.source as string) ?? 'ai') as StoryTaskSource,
  };
}

export function replaceStoryTasks(
  storyId: string,
  projectId: string,
  strategy: string,
  model: string | null,
  source: StoryTaskSource,
  drafts: StoryTaskDraft[],
): { tasks: StoryTask[]; edges: StoryTaskEdge[] } {
  return transaction(() => {
    deleteStoryTasks(storyId);
    const created = drafts.map((draft, index) =>
      createStoryTask({
        projectId,
        storyId,
        seq: index + 1,
        key: draft.key,
        title: draft.title,
        description: draft.description,
        files: draft.files,
        acIds: draft.acIds,
        verifyCommand: draft.verifyCommand ?? null,
        source,
      }),
    );
    const idByKey = new Map(created.map((task) => [task.key, task.id]));
    for (let index = 0; index < drafts.length; index++) {
      for (const dependency of drafts[index].dependsOn) {
        const predecessorId = idByKey.get(dependency);
        if (predecessorId) insertTaskDependency(created[index].id, predecessorId);
      }
    }
    saveStoryTaskPlan({ storyId, projectId, strategy, model, source });
    return { tasks: listStoryTasks(storyId), edges: listTaskEdges(storyId) };
  });
}

export function storyTaskSummaries(projectId?: string): Map<string, StoryTaskSummary> {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM story_tasks WHERE project_id = ? ORDER BY story_id, seq').all(projectId)
      : db.prepare('SELECT * FROM story_tasks ORDER BY story_id, seq').all()
  ) as Record<string, unknown>[];
  const map = new Map<string, StoryTaskSummary>();
  for (const row of rows) {
    const task = mapStoryTask(row);
    const entry = map.get(task.storyId) ?? {
      storyId: task.storyId,
      total: 0,
      done: 0,
      failed: 0,
      currentKey: null,
      currentTitle: null,
      tokens: 0,
    };
    entry.total++;
    entry.tokens += task.tokens;
    if (task.status === 'done' || task.status === 'skipped') entry.done++;
    if (task.status === 'failed') entry.failed++;
    if (task.status === 'in_progress') {
      entry.currentKey = task.key;
      entry.currentTitle = task.title;
    } else if (!entry.currentKey && task.status === 'pending') {
      entry.currentKey = task.key;
      entry.currentTitle = task.title;
    }
    map.set(task.storyId, entry);
  }
  return map;
}

export function storyTaskMetrics(projectId?: string): StoryTaskMetrics {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM story_tasks WHERE project_id = ?').all(projectId)
      : db.prepare('SELECT * FROM story_tasks').all()
  ) as Record<string, unknown>[];
  const tasks = rows.map(mapStoryTask);
  const done = tasks.filter((task) => task.status === 'done');
  const finished = tasks.filter((task) => task.status === 'done' || task.status === 'failed' || task.status === 'skipped');
  const cycles = done
    .map((task) => new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    total: tasks.length,
    done: done.length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length,
    firstPassRate: done.length ? done.filter((task) => task.attempts <= 1).length / done.length : null,
    avgAttempts: finished.length ? finished.reduce((sum, task) => sum + task.attempts, 0) / finished.length : null,
    avgCycleMs: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
    tokens: tasks.reduce((sum, task) => sum + task.tokens, 0),
  };
}

// ---- requirements (discovery track) ----

function mapRequirement(r: Record<string, unknown>): Requirement {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    rawInput: r.raw_input as string,
    intake: r.intake_json ? (JSON.parse(r.intake_json as string) as RequirementIntake) : null,
    source: (r.source as string) ?? 'manual',
    parentRequirementId: (r.parent_requirement_id as string | null) ?? null,
    changeRequestId: (r.change_request_id as string | null) ?? null,
    derivedFromRequirementId: (r.derived_from_requirement_id as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? null,
    status: r.status as RequirementStatus,
    currentVersion: Number(r.current_version),
    approvedVersion: (r.approved_version as number | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function mapRequirementVersion(r: Record<string, unknown>): RequirementVersion {
  return {
    id: r.id as string,
    requirementId: r.requirement_id as string,
    version: Number(r.version),
    draft: r.draft_json ? (JSON.parse(r.draft_json as string) as RequirementDraft) : null,
    issues: JSON.parse(r.issues_json as string) as RequirementIssue[],
    model: (r.model as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapRequirementFeedback(r: Record<string, unknown>): RequirementFeedback {
  return {
    id: r.id as string,
    requirementId: r.requirement_id as string,
    version: Number(r.version),
    storyKey: (r.story_key as string | null) ?? null,
    decision: r.decision as RequirementFeedbackDecision,
    comment: (r.comment as string | null) ?? null,
    decidedBy: r.decided_by as string,
    createdAt: r.created_at as string,
  };
}

export function createRequirement(input: {
  projectId: string;
  title: string;
  rawInput: string;
  intake?: Partial<RequirementIntake> | null;
  source?: string;
  parentRequirementId?: string | null;
  changeRequestId?: string | null;
  derivedFromRequirementId?: string | null;
  categoryId?: string | null;
}): Requirement {
  const project = getProject(input.projectId);
  if (!input.title?.trim()) throw new Error('requirement title required');
  if (!input.rawInput?.trim()) throw new Error('requirement raw input required');
  const intake: RequirementIntake | null = input.intake
    ? {
        goal: input.intake.goal?.trim() ?? '',
        users: input.intake.users?.trim() ?? '',
        constraints: input.intake.constraints?.trim() ?? '',
        nonGoals: input.intake.nonGoals?.trim() ?? '',
        successMetrics: input.intake.successMetrics?.trim() ?? '',
        examples: input.intake.examples?.trim() ?? '',
      }
    : null;
  const r: Requirement = {
    id: randomUUID(),
    projectId: project.id,
    title: input.title.trim(),
    rawInput: input.rawInput.trim(),
    intake,
    source: input.source?.trim() || 'manual',
    parentRequirementId: input.parentRequirementId ?? null,
    changeRequestId: input.changeRequestId ?? null,
    derivedFromRequirementId: input.derivedFromRequirementId ?? null,
    categoryId: input.categoryId ?? null,
    status: 'intake',
    currentVersion: 0,
    approvedVersion: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO requirements (id, project_id, title, raw_input, intake_json, source, parent_requirement_id, change_request_id, derived_from_requirement_id, category_id, status, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    r.id,
    r.projectId,
    r.title,
    r.rawInput,
    r.intake ? JSON.stringify(r.intake) : null,
    r.source,
    r.parentRequirementId,
    r.changeRequestId,
    r.derivedFromRequirementId,
    r.categoryId,
    r.status,
    r.currentVersion,
    r.createdAt,
    r.updatedAt,
  );
  return r;
}

export function getRequirement(id: string): Requirement {
  return mapRequirement(row<Record<string, unknown>>(db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function listRequirements(projectId?: string): Requirement[] {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM requirements WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : db.prepare('SELECT * FROM requirements ORDER BY created_at DESC').all()
  ) as Record<string, unknown>[];
  return rows.map(mapRequirement);
}

export function setRequirementStatus(id: string, to: RequirementStatus): Requirement {
  const r = getRequirement(id);
  if (!REQUIREMENT_FLOW[r.status].includes(to)) {
    throw new Error(`invalid requirement transition: ${r.status} -> ${to}`);
  }
  db.prepare('UPDATE requirements SET status = ?, updated_at = ? WHERE id = ?').run(to, now(), id);
  return getRequirement(id);
}

export function markRequirementApproved(id: string, version: number): Requirement {
  db.prepare('UPDATE requirements SET approved_version = ?, updated_at = ? WHERE id = ?').run(version, now(), id);
  return getRequirement(id);
}

export function addRequirementVersion(
  requirementId: string,
  draft: RequirementDraft | null,
  issues: RequirementIssue[],
  model: string | null,
): RequirementVersion {
  const requirement = getRequirement(requirementId);
  const version = requirement.currentVersion + 1;
  const v: RequirementVersion = {
    id: randomUUID(),
    requirementId,
    version,
    draft,
    issues,
    model,
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO requirement_versions (id, requirement_id, version, draft_json, issues_json, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(v.id, v.requirementId, v.version, draft ? JSON.stringify(draft) : null, JSON.stringify(issues), v.model, v.createdAt);
  db.prepare('UPDATE requirements SET current_version = ?, updated_at = ? WHERE id = ?').run(version, now(), requirementId);
  return v;
}

export function listRequirementVersions(requirementId: string): RequirementVersion[] {
  const rows = db
    .prepare('SELECT * FROM requirement_versions WHERE requirement_id = ? ORDER BY version')
    .all(requirementId) as Record<string, unknown>[];
  return rows.map(mapRequirementVersion);
}

export function latestRequirementVersion(requirementId: string): RequirementVersion | null {
  const r = db
    .prepare('SELECT * FROM requirement_versions WHERE requirement_id = ? ORDER BY version DESC LIMIT 1')
    .get(requirementId) as Record<string, unknown> | undefined;
  return r ? mapRequirementVersion(r) : null;
}

export function addRequirementFeedback(input: {
  requirementId: string;
  version: number;
  storyKey?: string | null;
  decision: RequirementFeedbackDecision;
  comment?: string | null;
  decidedBy?: string;
}): RequirementFeedback {
  const f: RequirementFeedback = {
    id: randomUUID(),
    requirementId: input.requirementId,
    version: input.version,
    storyKey: input.storyKey ?? null,
    decision: input.decision,
    comment: input.comment ?? null,
    decidedBy: input.decidedBy ?? 'human',
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO requirement_feedback (id, requirement_id, version, story_key, decision, comment, decided_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(f.id, f.requirementId, f.version, f.storyKey, f.decision, f.comment, f.decidedBy, f.createdAt);
  return f;
}

export function listRequirementFeedback(requirementId: string): RequirementFeedback[] {
  const rows = db
    .prepare('SELECT * FROM requirement_feedback WHERE requirement_id = ? ORDER BY created_at')
    .all(requirementId) as Record<string, unknown>[];
  return rows.map(mapRequirementFeedback);
}

// ---- requirement change requests ----

function mapChangeRequest(r: Record<string, unknown>): RequirementChangeRequest {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    requirementId: r.requirement_id as string,
    baselineVersion: Number(r.baseline_version ?? 0),
    changeType: (r.change_type as RequirementChangeType) ?? 'perfective',
    source: (r.source as RequirementChangeSource) ?? 'manual',
    title: r.title as string,
    reason: (r.reason as string) ?? '',
    status: (r.status as RequirementChangeStatus) ?? 'draft',
    impact: jsonList<ChangeImpactItem>(r.impact_json),
    decision: (r.decision as ChangeDecision | null) ?? null,
    derivedRequirementId: (r.derived_requirement_id as string | null) ?? null,
    iteration: (r.iteration as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
    externalUrl: (r.external_url as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createChangeRequest(input: {
  projectId: string;
  requirementId: string;
  baselineVersion: number;
  changeType: RequirementChangeType;
  source: RequirementChangeSource;
  title: string;
  reason: string;
  iteration?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
}): RequirementChangeRequest {
  const cr: RequirementChangeRequest = {
    id: randomUUID(),
    projectId: input.projectId,
    requirementId: input.requirementId,
    baselineVersion: input.baselineVersion,
    changeType: input.changeType,
    source: input.source,
    title: input.title.trim(),
    reason: input.reason.trim(),
    status: 'draft',
    impact: [],
    decision: null,
    derivedRequirementId: null,
    iteration: input.iteration?.trim() || null,
    externalId: input.externalId?.trim() || null,
    externalUrl: input.externalUrl?.trim() || null,
    decidedBy: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO requirement_change_requests (id, project_id, requirement_id, baseline_version, change_type, source, title, reason, status, impact_json, iteration, external_id, external_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    cr.id,
    cr.projectId,
    cr.requirementId,
    cr.baselineVersion,
    cr.changeType,
    cr.source,
    cr.title,
    cr.reason,
    cr.status,
    JSON.stringify(cr.impact),
    cr.iteration,
    cr.externalId,
    cr.externalUrl,
    cr.createdAt,
    cr.updatedAt,
  );
  return cr;
}

export function getChangeRequest(id: string): RequirementChangeRequest {
  return mapChangeRequest(row<Record<string, unknown>>(db.prepare('SELECT * FROM requirement_change_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function listChangeRequests(filters: { projectId?: string; requirementId?: string; status?: RequirementChangeStatus; iteration?: string } = {}): RequirementChangeRequest[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.projectId) {
    clauses.push('project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.requirementId) {
    clauses.push('requirement_id = ?');
    params.push(filters.requirementId);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.iteration) {
    clauses.push('iteration = ?');
    params.push(filters.iteration);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM requirement_change_requests${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
  return rows.map(mapChangeRequest);
}

export function updateChangeRequest(
  id: string,
  patch: {
    status?: RequirementChangeStatus;
    impact?: ChangeImpactItem[];
    decision?: ChangeDecision | null;
    derivedRequirementId?: string | null;
    decidedBy?: string | null;
  },
): RequirementChangeRequest {
  const cur = getChangeRequest(id);
  const next = {
    status: patch.status ?? cur.status,
    impact: patch.impact ?? cur.impact,
    decision: patch.decision !== undefined ? patch.decision : cur.decision,
    derivedRequirementId: patch.derivedRequirementId !== undefined ? patch.derivedRequirementId : cur.derivedRequirementId,
    decidedBy: patch.decidedBy !== undefined ? patch.decidedBy : cur.decidedBy,
  };
  db.prepare(
    'UPDATE requirement_change_requests SET status = ?, impact_json = ?, decision = ?, derived_requirement_id = ?, decided_by = ?, updated_at = ? WHERE id = ?',
  ).run(next.status, JSON.stringify(next.impact), next.decision, next.derivedRequirementId, next.decidedBy, now(), id);
  return getChangeRequest(id);
}

export function changeMetrics(projectId?: string, iteration?: string): ChangeMetrics {
  const items = listChangeRequests({ projectId, iteration });
  const decided = items.filter((item) => ['approved', 'rejected', 'materialized'].includes(item.status));
  const cycles = decided
    .map((item) => new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    total: items.length,
    approved: items.filter((item) => item.status === 'approved' || item.status === 'materialized').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
    materialized: items.filter((item) => item.status === 'materialized').length,
    avgCycleMs: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
    impactStories: items.reduce((sum, item) => sum + item.impact.length, 0),
  };
}

// ---- bug reports ----

function mapBugReport(r: Record<string, unknown>): BugReport {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    storyId: r.story_id as string,
    requirementId: (r.requirement_id as string | null) ?? null,
    acIds: jsonList<string>(r.ac_ids_json),
    title: r.title as string,
    description: (r.description as string) ?? '',
    steps: (r.steps as string) ?? '',
    expected: (r.expected as string) ?? '',
    actual: (r.actual as string) ?? '',
    environment: (r.environment as string) ?? '',
    evidence: jsonList<string>(r.evidence_json),
    severity: (r.severity as BugSeverity) ?? 'major',
    priority: (r.priority as BugPriority) ?? 'P2',
    reproducibility: (r.reproducibility as BugReproducibility) ?? 'always',
    status: (r.status as BugStatus) ?? 'new',
    duplicateOf: (r.duplicate_of as string | null) ?? null,
    triageNote: (r.triage_note as string | null) ?? null,
    fixStoryId: (r.fix_story_id as string | null) ?? null,
    regressionTest: (r.regression_test as string | null) ?? null,
    rootCause: (r.root_cause as string | null) ?? null,
    resolution: (r.resolution as string | null) ?? null,
    reporter: (r.reporter as string) ?? 'human',
    reopenCount: Number(r.reopen_count ?? 0),
    slaDueAt: (r.sla_due_at as string | null) ?? null,
    externalId: (r.external_id as string | null) ?? null,
    externalUrl: (r.external_url as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createBugReport(input: {
  projectId: string;
  storyId: string;
  requirementId?: string | null;
  acIds?: string[];
  title: string;
  description?: string;
  steps: string;
  expected: string;
  actual: string;
  environment?: string;
  evidence?: string[];
  severity?: BugSeverity;
  priority?: BugPriority;
  reproducibility?: BugReproducibility;
  reporter?: string;
  slaDueAt?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
}): BugReport {
  const bug: BugReport = {
    id: randomUUID(),
    projectId: input.projectId,
    storyId: input.storyId,
    requirementId: input.requirementId ?? null,
    acIds: input.acIds ?? [],
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    steps: input.steps.trim(),
    expected: input.expected.trim(),
    actual: input.actual.trim(),
    environment: input.environment?.trim() ?? '',
    evidence: input.evidence ?? [],
    severity: input.severity ?? 'major',
    priority: input.priority ?? 'P2',
    reproducibility: input.reproducibility ?? 'always',
    status: 'new',
    duplicateOf: null,
    triageNote: null,
    fixStoryId: null,
    regressionTest: null,
    rootCause: null,
    resolution: null,
    reporter: input.reporter?.trim() || 'human',
    reopenCount: 0,
    slaDueAt: input.slaDueAt ?? null,
    externalId: input.externalId?.trim() || null,
    externalUrl: input.externalUrl?.trim() || null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO bug_reports (id, project_id, story_id, requirement_id, ac_ids_json, title, description, steps, expected, actual, environment, evidence_json, severity, priority, reproducibility, status, reporter, sla_due_at, external_id, external_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    bug.id,
    bug.projectId,
    bug.storyId,
    bug.requirementId,
    JSON.stringify(bug.acIds),
    bug.title,
    bug.description,
    bug.steps,
    bug.expected,
    bug.actual,
    bug.environment,
    JSON.stringify(bug.evidence),
    bug.severity,
    bug.priority,
    bug.reproducibility,
    bug.status,
    bug.reporter,
    bug.slaDueAt,
    bug.externalId,
    bug.externalUrl,
    bug.createdAt,
    bug.updatedAt,
  );
  return bug;
}

export function getBugReport(id: string): BugReport {
  return mapBugReport(row<Record<string, unknown>>(db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function listBugReports(filters: { projectId?: string; storyId?: string; status?: BugStatus; severity?: BugSeverity } = {}): BugReport[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.projectId) {
    clauses.push('project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.storyId) {
    clauses.push('story_id = ?');
    params.push(filters.storyId);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    clauses.push('severity = ?');
    params.push(filters.severity);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM bug_reports${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
  return rows.map(mapBugReport);
}

export function updateBugReport(
  id: string,
  patch: {
    acIds?: string[];
    severity?: BugSeverity;
    priority?: BugPriority;
    reproducibility?: BugReproducibility;
    status?: BugStatus;
    duplicateOf?: string | null;
    triageNote?: string | null;
    fixStoryId?: string | null;
    regressionTest?: string | null;
    rootCause?: string | null;
    resolution?: string | null;
    reopenCount?: number;
    slaDueAt?: string | null;
  },
): BugReport {
  const cur = getBugReport(id);
  const next = {
    acIds: patch.acIds ?? cur.acIds,
    severity: patch.severity ?? cur.severity,
    priority: patch.priority ?? cur.priority,
    reproducibility: patch.reproducibility ?? cur.reproducibility,
    status: patch.status ?? cur.status,
    duplicateOf: patch.duplicateOf !== undefined ? patch.duplicateOf : cur.duplicateOf,
    triageNote: patch.triageNote !== undefined ? patch.triageNote : cur.triageNote,
    fixStoryId: patch.fixStoryId !== undefined ? patch.fixStoryId : cur.fixStoryId,
    regressionTest: patch.regressionTest !== undefined ? patch.regressionTest : cur.regressionTest,
    rootCause: patch.rootCause !== undefined ? patch.rootCause : cur.rootCause,
    resolution: patch.resolution !== undefined ? patch.resolution : cur.resolution,
    reopenCount: patch.reopenCount ?? cur.reopenCount,
    slaDueAt: patch.slaDueAt !== undefined ? patch.slaDueAt : cur.slaDueAt,
  };
  db.prepare(
    'UPDATE bug_reports SET ac_ids_json = ?, severity = ?, priority = ?, reproducibility = ?, status = ?, duplicate_of = ?, triage_note = ?, fix_story_id = ?, regression_test = ?, root_cause = ?, resolution = ?, reopen_count = ?, sla_due_at = ?, updated_at = ? WHERE id = ?',
  ).run(
    JSON.stringify(next.acIds),
    next.severity,
    next.priority,
    next.reproducibility,
    next.status,
    next.duplicateOf,
    next.triageNote,
    next.fixStoryId,
    next.regressionTest,
    next.rootCause,
    next.resolution,
    next.reopenCount,
    next.slaDueAt,
    now(),
    id,
  );
  return getBugReport(id);
}

export function bugMetrics(projectId?: string): BugMetrics {
  const bugs = listBugReports({ projectId });
  const openStatuses: BugStatus[] = ['new', 'triaged', 'accepted', 'fixing', 'fixed', 'verified', 'reopened'];
  const closed = bugs.filter((bug) => bug.status === 'closed');
  const nowMs = Date.now();
  const cycles = closed
    .map((bug) => new Date(bug.updatedAt).getTime() - new Date(bug.createdAt).getTime())
    .filter((value) => Number.isFinite(value) && value >= 0);
  const bySeverity: Record<BugSeverity, number> = { blocker: 0, critical: 0, major: 0, minor: 0 };
  for (const bug of bugs) bySeverity[bug.severity]++;
  return {
    total: bugs.length,
    open: bugs.filter((bug) => openStatuses.includes(bug.status)).length,
    fixed: bugs.filter((bug) => bug.status === 'fixed').length,
    closed: closed.length,
    rejected: bugs.filter((bug) => bug.status === 'rejected').length,
    duplicate: bugs.filter((bug) => bug.status === 'duplicate').length,
    overdue: bugs.filter(
      (bug) => openStatuses.includes(bug.status) && bug.slaDueAt && new Date(bug.slaDueAt).getTime() < nowMs,
    ).length,
    mttrMs: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
    reopenRate: bugs.length ? bugs.filter((bug) => bug.reopenCount > 0).length / bugs.length : null,
    bySeverity,
  };
}

function mapRequirementMessage(r: Record<string, unknown>): RequirementMessage {
  return {
    id: r.id as string,
    requirementId: r.requirement_id as string,
    role: r.role as RequirementMessageRole,
    content: r.content as string,
    ready: Boolean(r.ready),
    createdAt: r.created_at as string,
  };
}

export function addRequirementMessage(input: {
  requirementId: string;
  role: RequirementMessageRole;
  content: string;
  ready?: boolean;
}): RequirementMessage {
  const message: RequirementMessage = {
    id: randomUUID(),
    requirementId: input.requirementId,
    role: input.role,
    content: input.content,
    ready: Boolean(input.ready),
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO requirement_messages (id, requirement_id, role, content, ready, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(message.id, message.requirementId, message.role, message.content, message.ready ? 1 : 0, message.createdAt);
  db.prepare('UPDATE requirements SET updated_at = ? WHERE id = ?').run(message.createdAt, input.requirementId);
  return message;
}

export function listRequirementMessages(requirementId: string): RequirementMessage[] {
  const rows = db
    .prepare('SELECT * FROM requirement_messages WHERE requirement_id = ? ORDER BY created_at, rowid')
    .all(requirementId) as Record<string, unknown>[];
  return rows.map(mapRequirementMessage);
}

export function updateRequirementIntake(id: string, intake: RequirementIntake): Requirement {
  db.prepare('UPDATE requirements SET intake_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(intake), now(), id);
  return getRequirement(id);
}

export function updateRequirementTitle(id: string, title: string): Requirement {
  db.prepare('UPDATE requirements SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id);
  return getRequirement(id);
}

export function historicalRequirementStoryTitles(projectId: string, excludeRequirementId: string): string[] {
  const rows = db
    .prepare(
      `SELECT rv.draft_json FROM requirement_versions rv
       JOIN requirements r ON r.id = rv.requirement_id
       WHERE r.project_id = ? AND r.id != ? AND r.status != 'archived'`,
    )
    .all(projectId, excludeRequirementId) as { draft_json: string | null }[];
  const titles = new Set<string>();
  for (const row of rows) {
    if (!row.draft_json) continue;
    try {
      const draft = JSON.parse(row.draft_json) as RequirementDraft;
      for (const story of draft.stories ?? []) {
        if (story.title?.trim()) titles.add(story.title.trim());
      }
    } catch {
      // ignore malformed historical drafts
    }
  }
  return [...titles];
}

function mapRequirementJob(r: Record<string, unknown>): RequirementJob {
  return {
    requirementId: r.requirement_id as string,
    status: r.status as RequirementJobStatus,
    startedAt: r.started_at as string,
    heartbeatAt: r.heartbeat_at as string,
    cancelRequested: Boolean(r.cancel_requested),
    error: (r.error as string | null) ?? null,
  };
}

export function startRequirementJob(requirementId: string): RequirementJob {
  const ts = now();
  db.prepare(
    `INSERT INTO requirement_jobs (requirement_id, status, started_at, heartbeat_at, cancel_requested, error)
     VALUES (?, 'running', ?, ?, 0, NULL)
     ON CONFLICT(requirement_id) DO UPDATE SET status = 'running', started_at = excluded.started_at,
       heartbeat_at = excluded.heartbeat_at, cancel_requested = 0, error = NULL`,
  ).run(requirementId, ts, ts);
  return getRequirementJob(requirementId)!;
}

export function heartbeatRequirementJob(requirementId: string): void {
  db.prepare("UPDATE requirement_jobs SET heartbeat_at = ? WHERE requirement_id = ? AND status = 'running'").run(
    now(),
    requirementId,
  );
}

export function finishRequirementJob(requirementId: string, status: RequirementJobStatus, error?: string): void {
  db.prepare('UPDATE requirement_jobs SET status = ?, error = ?, heartbeat_at = ? WHERE requirement_id = ?').run(
    status,
    error ?? null,
    now(),
    requirementId,
  );
}

export function requestRequirementCancel(requirementId: string): RequirementJob {
  db.prepare("UPDATE requirement_jobs SET cancel_requested = 1, heartbeat_at = ? WHERE requirement_id = ? AND status = 'running'").run(
    now(),
    requirementId,
  );
  return getRequirementJob(requirementId) ?? {
    requirementId,
    status: 'cancelled',
    startedAt: now(),
    heartbeatAt: now(),
    cancelRequested: true,
    error: null,
  };
}

export function getRequirementJob(requirementId: string): RequirementJob | null {
  const r = db.prepare('SELECT * FROM requirement_jobs WHERE requirement_id = ?').get(requirementId) as
    | Record<string, unknown>
    | undefined;
  return r ? mapRequirementJob(r) : null;
}

export function listRunningRequirementJobs(): RequirementJob[] {
  const rows = db.prepare("SELECT * FROM requirement_jobs WHERE status = 'running'").all() as Record<string, unknown>[];
  return rows.map(mapRequirementJob);
}

// ---- categories ----

function mapCategory(r: Record<string, unknown>): Category {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    name: r.name as string,
    path: r.path as string,
    depth: Number(r.depth),
    sort: Number(r.sort),
    source: (r.source as Category['source']) ?? 'manual',
    status: (r.status as Category['status']) ?? 'active',
    createdAt: r.created_at as string,
  };
}

export function listCategories(projectId?: string): Category[] {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM categories WHERE project_id = ? ORDER BY path, sort, name').all(projectId)
      : db.prepare('SELECT * FROM categories ORDER BY project_id, path, sort, name').all()
  ) as Record<string, unknown>[];
  return rows.map(mapCategory);
}

export function getCategory(id: string): Category {
  return mapCategory(row<Record<string, unknown>>(db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function createCategory(input: {
  projectId: string;
  name: string;
  parentId?: string | null;
  source?: Category['source'];
  status?: Category['status'];
}): Category {
  getProject(input.projectId);
  const name = input.name.trim();
  if (!name) throw new Error('分类名称不能为空');
  const parent = input.parentId ? getCategory(input.parentId) : null;
  if (parent && parent.projectId !== input.projectId) throw new Error('分类必须属于同一项目');
  const depth = parent ? parent.depth + 1 : 1;
  if (depth > 3) throw new Error('分类最多支持三级');
  const id = randomUUID();
  const c: Category = {
    id,
    projectId: input.projectId,
    parentId: parent?.id ?? null,
    name,
    path: parent ? `${parent.path}${id}/` : `/${id}/`,
    depth,
    sort: listCategories(input.projectId).filter((item) => item.parentId === (parent?.id ?? null)).length,
    source: input.source ?? 'manual',
    status: input.status ?? 'active',
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO categories (id, project_id, parent_id, name, path, depth, sort, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    c.id,
    c.projectId,
    c.parentId,
    c.name,
    c.path,
    c.depth,
    c.sort,
    c.source ?? 'manual',
    c.status ?? 'active',
    c.createdAt,
  );
  return c;
}

export function renameCategory(id: string, name: string): Category {
  const next = name.trim();
  if (!next) throw new Error('分类名称不能为空');
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(next, id);
  return getCategory(id);
}

export function deleteCategory(id: string): void {
  const children = db.prepare('SELECT id FROM categories WHERE parent_id = ? LIMIT 1').get(id);
  if (children) throw new Error('请先删除子分类');
  const req = db.prepare('SELECT id FROM requirements WHERE category_id = ? LIMIT 1').get(id);
  const story = db.prepare('SELECT id FROM stories WHERE category_id = ? LIMIT 1').get(id);
  if (req || story) throw new Error('分类已被需求或故事使用，不能删除');
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

export function categoryScopeIds(projectId: string, categoryId: string | null | undefined): string[] {
  if (!categoryId) return [];
  const category = getCategory(categoryId);
  if (category.projectId !== projectId) throw new Error('分类不属于该项目');
  const rows = db
    .prepare('SELECT id FROM categories WHERE project_id = ? AND (id = ? OR path LIKE ?)')
    .all(projectId, category.id, `${category.path}%`) as { id: string }[];
  return rows.map((r) => r.id);
}

export function setRequirementCategory(id: string, categoryId: string | null): Requirement {
  const requirement = getRequirement(id);
  if (categoryId) {
    const category = getCategory(categoryId);
    if (category.projectId !== requirement.projectId) throw new Error('分类不属于该需求的项');
  }
  db.prepare('UPDATE requirements SET category_id = ?, updated_at = ? WHERE id = ?').run(categoryId, now(), id);
  return getRequirement(id);
}

export function setStoryCategory(id: string, categoryId: string | null): Story {
  const story = getStory(id);
  if (categoryId) {
    const category = getCategory(categoryId);
    if (category.projectId !== story.projectId) throw new Error('分类不属于该故事的项');
  }
  db.prepare('UPDATE stories SET category_id = ?, updated_at = ? WHERE id = ?').run(categoryId, now(), id);
  return getStory(id);
}

// ---- tags ----

function mapTag(r: Record<string, unknown>): Tag {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    color: r.color as string,
    source: (r.source as Tag['source']) ?? 'manual',
    status: (r.status as Tag['status']) ?? 'active',
    createdAt: r.created_at as string,
  };
}

export function listTags(projectId?: string): Tag[] {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM tags WHERE project_id = ? ORDER BY name').all(projectId)
      : db.prepare('SELECT * FROM tags ORDER BY project_id, name').all()
  ) as Record<string, unknown>[];
  return rows.map(mapTag);
}

export function createTag(input: {
  projectId: string;
  name: string;
  color?: string;
  source?: Tag['source'];
  status?: Tag['status'];
}): Tag {
  getProject(input.projectId);
  const name = input.name.trim();
  if (!name) throw new Error('标签名称不能为空');
  if (listTags(input.projectId).some((tag) => tag.name === name)) throw new Error('标签已存在');
  const tag: Tag = {
    id: randomUUID(),
    projectId: input.projectId,
    name,
    color: input.color?.trim() || '#5b8cff',
    source: input.source ?? 'manual',
    status: input.status ?? 'active',
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO tags (id, project_id, name, color, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(tag.id, tag.projectId, tag.name, tag.color, tag.source ?? 'manual', tag.status ?? 'active', tag.createdAt);
  return tag;
}

export function deleteTag(id: string): void {
  db.prepare('DELETE FROM entity_tags WHERE tag_id = ?').run(id);
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
}

export function tagsForEntity(type: DependencyEntityType, id: string): Tag[] {
  const rows = db
    .prepare(
      `SELECT t.* FROM tags t JOIN entity_tags et ON et.tag_id = t.id
       WHERE et.entity_type = ? AND et.entity_id = ? ORDER BY t.name`,
    )
    .all(type, id) as Record<string, unknown>[];
  return rows.map(mapTag);
}

export function tagsByEntity(projectId: string, type: DependencyEntityType): Map<string, Tag[]> {
  const rows = db
    .prepare(
      `SELECT et.entity_id, t.* FROM entity_tags et JOIN tags t ON t.id = et.tag_id
       WHERE et.project_id = ? AND et.entity_type = ? ORDER BY t.name`,
    )
    .all(projectId, type) as Record<string, unknown>[];
  const map = new Map<string, Tag[]>();
  for (const rowValue of rows) {
    const entityId = rowValue.entity_id as string;
    const list = map.get(entityId) ?? [];
    list.push(mapTag(rowValue));
    map.set(entityId, list);
  }
  return map;
}

export function setEntityTags(type: DependencyEntityType, id: string, tagIds: string[]): Tag[] {
  const projectId = type === 'requirement' ? getRequirement(id).projectId : getStory(id).projectId;
  const tags = listTags(projectId);
  const wanted = [...new Set(tagIds)];
  for (const tagId of wanted) {
    if (!tags.some((tag) => tag.id === tagId)) throw new Error('标签不属于该项目');
  }
  transaction(() => {
    db.prepare('DELETE FROM entity_tags WHERE entity_type = ? AND entity_id = ?').run(type, id);
    const insert = db.prepare(
      'INSERT INTO entity_tags (project_id, entity_type, entity_id, tag_id) VALUES (?, ?, ?, ?)',
    );
    for (const tagId of wanted) insert.run(projectId, type, id, tagId);
  });
  return tagsForEntity(type, id);
}

export function entityIdsForTag(projectId: string, type: DependencyEntityType, tagId: string): string[] {
  const rows = db
    .prepare('SELECT entity_id FROM entity_tags WHERE project_id = ? AND entity_type = ? AND tag_id = ?')
    .all(projectId, type, tagId) as { entity_id: string }[];
  return rows.map((rowValue) => rowValue.entity_id);
}

// ---- embeddings ----

export function getEntityEmbedding(
  entityType: DependencyEntityType,
  entityId: string,
): { model: string; hash: string; vector: number[] } | null {
  const rowValue = db
    .prepare('SELECT model, content_hash, vector_json FROM entity_embeddings WHERE entity_type = ? AND entity_id = ?')
    .get(entityType, entityId) as { model: string; content_hash: string; vector_json: string } | undefined;
  if (!rowValue) return null;
  try {
    return { model: rowValue.model, hash: rowValue.content_hash, vector: JSON.parse(rowValue.vector_json) as number[] };
  } catch {
    return null;
  }
}

export function saveEntityEmbedding(input: {
  entityType: DependencyEntityType;
  entityId: string;
  model: string;
  hash: string;
  vector: number[];
}): void {
  db.prepare(
    `INSERT INTO entity_embeddings (entity_type, entity_id, model, content_hash, vector_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET model = excluded.model, content_hash = excluded.content_hash,
       vector_json = excluded.vector_json, updated_at = excluded.updated_at`,
  ).run(input.entityType, input.entityId, input.model, input.hash, JSON.stringify(input.vector), now());
}

// ---- dependencies ----

function mapDependency(r: Record<string, unknown>): Dependency {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    predecessorType: r.predecessor_type as DependencyEntityType,
    predecessorId: r.predecessor_id as string,
    successorType: r.successor_type as DependencyEntityType,
    successorId: r.successor_id as string,
    kind: (r.kind as Dependency['kind']) ?? 'finish_to_start',
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export function listDependencies(projectId: string, type?: DependencyEntityType): Dependency[] {
  const rows = (
    type
      ? db
          .prepare('SELECT * FROM dependencies WHERE project_id = ? AND predecessor_type = ? AND successor_type = ? ORDER BY created_at')
          .all(projectId, type, type)
      : db.prepare('SELECT * FROM dependencies WHERE project_id = ? ORDER BY created_at').all(projectId)
  ) as Record<string, unknown>[];
  return rows.map(mapDependency);
}

export function getDependency(id: string): Dependency {
  return mapDependency(row<Record<string, unknown>>(db.prepare('SELECT * FROM dependencies WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function insertDependency(input: {
  projectId: string;
  predecessorType: DependencyEntityType;
  predecessorId: string;
  successorType: DependencyEntityType;
  successorId: string;
  note?: string | null;
}): Dependency {
  const d: Dependency = {
    id: randomUUID(),
    projectId: input.projectId,
    predecessorType: input.predecessorType,
    predecessorId: input.predecessorId,
    successorType: input.successorType,
    successorId: input.successorId,
    kind: 'finish_to_start',
    note: input.note?.trim() || null,
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO dependencies (id, project_id, predecessor_type, predecessor_id, successor_type, successor_id, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(d.id, d.projectId, d.predecessorType, d.predecessorId, d.successorType, d.successorId, d.kind, d.note, d.createdAt);
  return d;
}

export function deleteDependency(id: string): void {
  db.prepare('DELETE FROM dependencies WHERE id = ?').run(id);
}

export function saveRequirementSplitDraft(draft: RequirementSplitDraft): RequirementSplitDraft {
  db.prepare(
    `INSERT INTO requirement_split_drafts (requirement_id, version, draft_json, model, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(requirement_id) DO UPDATE SET version = excluded.version, draft_json = excluded.draft_json,
       model = excluded.model, created_at = excluded.created_at`,
  ).run(draft.requirementId, draft.version, JSON.stringify(draft), draft.model, draft.createdAt);
  return draft;
}

export function getRequirementSplitDraft(requirementId: string): RequirementSplitDraft | null {
  const rowValue = db.prepare('SELECT draft_json FROM requirement_split_drafts WHERE requirement_id = ?').get(requirementId) as
    | { draft_json: string }
    | undefined;
  if (!rowValue) return null;
  try {
    return JSON.parse(rowValue.draft_json) as RequirementSplitDraft;
  } catch {
    return null;
  }
}

export function deleteRequirementSplitDraft(requirementId: string): void {
  db.prepare('DELETE FROM requirement_split_drafts WHERE requirement_id = ?').run(requirementId);
}

function mapHandoff(r: Record<string, unknown>): Handoff {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    entityType: r.entity_type as Handoff['entityType'],
    entityId: r.entity_id as string,
    title: r.title as string,
    summary: r.summary as string,
    files: JSON.parse(r.files_json as string) as HandoffFile[],
    contracts: (r.contracts as string | null) ?? null,
    migrations: JSON.parse(r.migrations_json as string) as string[],
    dod: JSON.parse(r.dod_json as string) as string[],
    acceptance: JSON.parse(r.acceptance_json as string) as string[],
    decisions: JSON.parse(r.decisions_json as string) as string[],
    createdAt: r.created_at as string,
  };
}

export function saveHandoff(input: Omit<Handoff, 'id' | 'createdAt'>): Handoff {
  const handoff: Handoff = {
    ...input,
    id: randomUUID(),
    createdAt: now(),
  };
  db.prepare(
    `INSERT INTO handoffs (id, project_id, entity_type, entity_id, title, summary, files_json, contracts,
       migrations_json, dod_json, acceptance_json, decisions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
       files_json = excluded.files_json, contracts = excluded.contracts, migrations_json = excluded.migrations_json,
       dod_json = excluded.dod_json, acceptance_json = excluded.acceptance_json,
       decisions_json = excluded.decisions_json, created_at = excluded.created_at`,
  ).run(
    handoff.id,
    handoff.projectId,
    handoff.entityType,
    handoff.entityId,
    handoff.title,
    handoff.summary,
    JSON.stringify(handoff.files),
    handoff.contracts,
    JSON.stringify(handoff.migrations),
    JSON.stringify(handoff.dod),
    JSON.stringify(handoff.acceptance),
    JSON.stringify(handoff.decisions),
    handoff.createdAt,
  );
  return handoff;
}

export function getHandoff(entityType: Handoff['entityType'], entityId: string): Handoff | null {
  const rowValue = db
    .prepare('SELECT * FROM handoffs WHERE entity_type = ? AND entity_id = ?')
    .get(entityType, entityId) as Record<string, unknown> | undefined;
  return rowValue ? mapHandoff(rowValue) : null;
}

// ---- releases ----

function mapRelease(r: Record<string, unknown>): Release {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    projectId: r.project_id as string,
    status: r.status as ReleaseStatus,
    command: r.command as string,
    output: (r.output as string | null) ?? null,
    releasedBy: r.released_by as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createRelease(storyId: string, projectId: string, command: string, releasedBy = 'human'): Release {
  const ts = now();
  const release: Release = {
    id: randomUUID(),
    storyId,
    projectId,
    status: 'running',
    command,
    output: null,
    releasedBy,
    createdAt: ts,
    updatedAt: ts,
  };
  db.prepare(
    'INSERT INTO releases (id, story_id, project_id, status, command, output, released_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    release.id,
    release.storyId,
    release.projectId,
    release.status,
    release.command,
    release.output,
    release.releasedBy,
    release.createdAt,
    release.updatedAt,
  );
  return release;
}

export function updateRelease(id: string, status: ReleaseStatus, output: string | null): Release {
  db.prepare('UPDATE releases SET status = ?, output = ?, updated_at = ? WHERE id = ?').run(
    status,
    output,
    now(),
    id,
  );
  return mapRelease(row<Record<string, unknown>>(db.prepare('SELECT * FROM releases WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function latestReleaseForStory(storyId: string): Release | null {
  const r = db.prepare('SELECT * FROM releases WHERE story_id = ? ORDER BY created_at DESC LIMIT 1').get(storyId) as
    | Record<string, unknown>
    | undefined;
  return r ? mapRelease(r) : null;
}

// ---- knowledge ----

function mapKnowledge(r: Record<string, unknown>): KnowledgeEntry {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as KnowledgeKind,
    title: r.title as string,
    content: r.content as string,
    tags: r.tags as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function addKnowledge(input: {
  projectId: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  tags?: string;
}): KnowledgeEntry {
  const ts = now();
  const entry: KnowledgeEntry = {
    id: randomUUID(),
    projectId: input.projectId,
    kind: input.kind,
    title: input.title.trim(),
    content: input.content.trim(),
    tags: input.tags?.trim() ?? '',
    createdAt: ts,
    updatedAt: ts,
  };
  db.prepare(
    'INSERT INTO knowledge (id, project_id, kind, title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    entry.id,
    entry.projectId,
    entry.kind,
    entry.title,
    entry.content,
    entry.tags,
    entry.createdAt,
    entry.updatedAt,
  );
  return entry;
}

export function listKnowledge(projectId: string): KnowledgeEntry[] {
  const rows = db
    .prepare('SELECT * FROM knowledge WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapKnowledge);
}

export function deleteKnowledge(id: string): void {
  db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
}

function bigramsOf(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const out = new Set<string>();
  if (normalized.length <= 1) {
    if (normalized) out.add(normalized);
    return out;
  }
  for (let i = 0; i < normalized.length - 1; i++) out.add(normalized.slice(i, i + 2));
  return out;
}

function overlapScore(a: string, b: string): number {
  const left = bigramsOf(a);
  const right = bigramsOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

export function searchKnowledge(projectId: string, query: string, limit = 5): KnowledgeEntry[] {
  const entries = listKnowledge(projectId);
  if (!query.trim()) return entries.slice(0, limit);
  const scored = entries
    .map((entry) => ({
      entry,
      score: overlapScore(query, `${entry.title} ${entry.tags}`) * 2 + overlapScore(query, entry.content),
    }))
    .filter((item) => item.score >= 0.05)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.entry);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // keep original error
    }
    throw err;
  }
}

// ---- dod items ----

function mapDod(r: Record<string, unknown>): DodItem {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    kind: r.kind as string,
    label: r.label as string,
    command: (r.command as string | null) ?? null,
    blocking: r.blocking === undefined ? true : Boolean(r.blocking),
    status: r.status as DodStatus,
    evidence: (r.evidence as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function createDodItem(
  storyId: string,
  kind: string,
  label: string,
  command: string | null,
  blocking = true,
): DodItem {
  const item: DodItem = {
    id: randomUUID(),
    storyId,
    kind,
    label,
    command,
    blocking,
    status: 'pending',
    evidence: null,
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO dod_items (id, story_id, kind, label, command, blocking, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    item.id,
    item.storyId,
    item.kind,
    item.label,
    item.command,
    item.blocking ? 1 : 0,
    item.status,
    item.updatedAt,
  );
  return item;
}

export function dodItemsForStory(storyId: string): DodItem[] {
  const rows = db.prepare('SELECT * FROM dod_items WHERE story_id = ? ORDER BY rowid').all(storyId) as Record<string, unknown>[];
  return rows.map(mapDod);
}

export function setDodResult(id: string, status: DodStatus, evidence: string): DodItem {
  db.prepare('UPDATE dod_items SET status = ?, evidence = ?, updated_at = ? WHERE id = ?').run(status, evidence, now(), id);
  return mapDod(row<Record<string, unknown>>(db.prepare('SELECT * FROM dod_items WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function resetDodItems(storyId: string): void {
  db.prepare("UPDATE dod_items SET status = 'pending', evidence = NULL, updated_at = ? WHERE story_id = ? AND kind != 'human'").run(now(), storyId);
}

// Project DoD edits apply to stories that have not started yet.
export function ensureDodItems(storyId: string, commands: DodCommand[]): void {
  const existing = dodItemsForStory(storyId);
  for (const cmd of commands) {
    if (!existing.some((i) => i.command === cmd.command && i.kind === cmd.kind)) {
      createDodItem(storyId, cmd.kind, cmd.label, cmd.command);
    }
  }
}

export function ensurePolicyGates(storyId: string, gates: PolicyGate[]): void {
  const existing = dodItemsForStory(storyId);
  for (const gate of gates) {
    if (!gate.command.trim()) continue;
    if (existing.some((i) => i.kind === 'policy' && i.label === gate.label && i.command === gate.command)) continue;
    createDodItem(storyId, 'policy', gate.label, gate.command, gate.blocking);
  }
}

// ---- story acceptance evidence ----

function mapAcceptance(r: Record<string, unknown>): StoryAcceptance {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    acId: r.ac_id as string,
    given: r.given_text as string,
    when: r.when_text as string,
    then: r.then_text as string,
    test: (r.test as string | null) ?? null,
    status: r.status as AcceptanceStatus,
    evidence: (r.evidence as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function createAcceptance(
  storyId: string,
  input: { acId: string; given: string; when: string; then: string; test?: string | null },
): StoryAcceptance {
  const a: StoryAcceptance = {
    id: randomUUID(),
    storyId,
    acId: input.acId,
    given: input.given,
    when: input.when,
    then: input.then,
    test: input.test?.trim() || null,
    status: 'pending',
    evidence: null,
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO story_acceptance (id, story_id, ac_id, given_text, when_text, then_text, test, status, evidence, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(a.id, a.storyId, a.acId, a.given, a.when, a.then, a.test, a.status, a.evidence, a.updatedAt);
  return a;
}

export function acceptanceForStory(storyId: string): StoryAcceptance[] {
  const rows = db
    .prepare('SELECT * FROM story_acceptance WHERE story_id = ? ORDER BY rowid')
    .all(storyId) as Record<string, unknown>[];
  return rows.map(mapAcceptance);
}

export function setAcceptanceResult(id: string, status: AcceptanceStatus, evidence: string): StoryAcceptance {
  db.prepare('UPDATE story_acceptance SET status = ?, evidence = ?, updated_at = ? WHERE id = ?').run(
    status,
    evidence,
    now(),
    id,
  );
  return mapAcceptance(row<Record<string, unknown>>(db.prepare('SELECT * FROM story_acceptance WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

// ---- agent sessions ----

function mapSession(r: Record<string, unknown>): AgentSession {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    agentKind: r.agent_kind as string,
    role: ((r.role as string) ?? 'solo') as AgentRole,
    model: (r.model as string | null) ?? null,
    acpSessionId: (r.acp_session_id as string | null) ?? null,
    pid: (r.pid as number | null) ?? null,
    status: r.status as SessionStatus,
    createdAt: r.created_at as string,
  };
}

export function createSession(storyId: string, agentKind = 'opencode', role: AgentRole = 'solo', model: string | null = null): AgentSession {
  const s: AgentSession = {
    id: randomUUID(),
    storyId,
    agentKind,
    role,
    model,
    acpSessionId: null,
    pid: null,
    status: 'starting',
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO agent_sessions (id, story_id, agent_kind, role, model, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(s.id, s.storyId, s.agentKind, s.role, s.model, s.status, s.createdAt);
  return s;
}

export function updateSession(
  id: string,
  patch: { acpSessionId?: string; pid?: number; status?: SessionStatus; model?: string | null },
): AgentSession {
  const cur = getSession(id);
  const next = {
    acpSessionId: patch.acpSessionId ?? cur.acpSessionId,
    pid: patch.pid ?? cur.pid,
    status: patch.status ?? cur.status,
    model: patch.model !== undefined ? patch.model : cur.model,
  };
  db.prepare('UPDATE agent_sessions SET acp_session_id = ?, pid = ?, status = ?, model = ? WHERE id = ?').run(
    next.acpSessionId,
    next.pid,
    next.status,
    next.model,
    id,
  );
  return getSession(id);
}

export function getSession(id: string): AgentSession {
  return mapSession(row<Record<string, unknown>>(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function sessionsForStory(storyId: string): AgentSession[] {
  const rows = db.prepare('SELECT * FROM agent_sessions WHERE story_id = ? ORDER BY created_at').all(storyId) as Record<string, unknown>[];
  return rows.map(mapSession);
}

// ---- approvals ----

function mapApproval(r: Record<string, unknown>): Approval {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    sessionId: (r.session_id as string | null) ?? null,
    kind: r.kind as ApprovalKind,
    title: r.title as string,
    requestJson: r.request_json as string,
    status: r.status as ApprovalStatus,
    optionId: (r.option_id as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    createdAt: r.created_at as string,
    decidedAt: (r.decided_at as string | null) ?? null,
  };
}

export function createApproval(input: {
  storyId: string;
  sessionId?: string | null;
  kind: ApprovalKind;
  title: string;
  requestJson: string;
}): Approval {
  const a: Approval = {
    id: randomUUID(),
    storyId: input.storyId,
    sessionId: input.sessionId ?? null,
    kind: input.kind,
    title: input.title,
    requestJson: input.requestJson,
    status: 'pending',
    optionId: null,
    decidedBy: null,
    createdAt: now(),
    decidedAt: null,
  };
  db.prepare(
    'INSERT INTO approvals (id, story_id, session_id, kind, title, request_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(a.id, a.storyId, a.sessionId, a.kind, a.title, a.requestJson, a.status, a.createdAt);
  return a;
}

export function getApproval(id: string): Approval {
  return mapApproval(row<Record<string, unknown>>(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined));
}

export function listApprovals(status?: ApprovalStatus): Approval[] {
  const rows = (
    status
      ? db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at').all(status)
      : db.prepare('SELECT * FROM approvals ORDER BY created_at').all()
  ) as Record<string, unknown>[];
  return rows.map(mapApproval);
}

export function decideApproval(
  id: string,
  decision: { status: 'approved' | 'denied'; optionId?: string; decidedBy?: string },
): Approval {
  const a = getApproval(id);
  if (a.status !== 'pending') throw new Error(`approval already ${a.status}`);
  db.prepare('UPDATE approvals SET status = ?, option_id = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(
    decision.status,
    decision.optionId ?? null,
    decision.decidedBy ?? 'human',
    now(),
    id,
  );
  return getApproval(id);
}

// ---- events ----

export function appendEvent(storyId: string, payload: EventPayload): EventRow {
  const ts = now();
  const result = db.prepare('INSERT INTO events (story_id, type, payload, ts) VALUES (?, ?, ?, ?)').run(
    storyId,
    payload.type,
    JSON.stringify(payload),
    ts,
  );
  return { seq: Number(result.lastInsertRowid), storyId, type: payload.type, payload, ts };
}

function mapEvent(r: Record<string, unknown>): EventRow {
  return {
    seq: Number(r.seq),
    storyId: r.story_id as string,
    type: r.type as EventPayload['type'],
    payload: JSON.parse(r.payload as string) as EventPayload,
    ts: r.ts as string,
  };
}

export function eventsAfter(afterSeq: number, limit = 1000): EventRow[] {
  const rows = db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(afterSeq, limit) as Record<string, unknown>[];
  return rows.map(mapEvent);
}

export function recentEvents(limit = 800): EventRow[] {
  const rows = db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(mapEvent).reverse();
}

export function eventsForStory(storyId: string, afterSeq = 0): EventRow[] {
  const rows = db.prepare('SELECT * FROM events WHERE story_id = ? AND seq > ? ORDER BY seq').all(storyId, afterSeq) as Record<string, unknown>[];
  return rows.map(mapEvent);
}

// ---- team runs ----

function mapTeamRun(r: Record<string, unknown>): TeamRun {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    phase: r.phase as TeamPhase,
    plan: JSON.parse(r.plan_json as string) as TeamPlanTask[],
    verdict: r.verdict_json ? (JSON.parse(r.verdict_json as string) as TeamVerdict) : null,
    turns: Number(r.turns),
    tokens: Number(r.tokens),
    startedAt: r.started_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createTeamRun(storyId: string): TeamRun {
  const t: TeamRun = {
    id: randomUUID(),
    storyId,
    phase: 'plan',
    plan: [],
    verdict: null,
    turns: 0,
    tokens: 0,
    startedAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO team_runs (id, story_id, phase, plan_json, turns, tokens, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(t.id, t.storyId, t.phase, JSON.stringify(t.plan), t.turns, t.tokens, t.startedAt, t.updatedAt);
  return t;
}

export function getTeamRun(storyId: string): TeamRun | null {
  const r = db.prepare('SELECT * FROM team_runs WHERE story_id = ? ORDER BY started_at DESC LIMIT 1').get(storyId) as Record<string, unknown> | undefined;
  return r ? mapTeamRun(r) : null;
}

export function updateTeamRun(
  storyId: string,
  patch: { phase?: TeamPhase; plan?: TeamPlanTask[]; verdict?: TeamVerdict; addTurns?: number; tokens?: number },
): TeamRun {
  const cur = getTeamRun(storyId);
  if (!cur) throw new Error('no team run');
  const next = {
    phase: patch.phase ?? cur.phase,
    plan: patch.plan ?? cur.plan,
    verdict: patch.verdict ?? cur.verdict,
    turns: cur.turns + (patch.addTurns ?? 0),
    tokens: patch.tokens != null ? Math.max(cur.tokens, patch.tokens) : cur.tokens,
  };
  db.prepare('UPDATE team_runs SET phase = ?, plan_json = ?, verdict_json = ?, turns = ?, tokens = ?, updated_at = ? WHERE id = ?').run(
    next.phase,
    JSON.stringify(next.plan),
    next.verdict ? JSON.stringify(next.verdict) : null,
    next.turns,
    next.tokens,
    now(),
    cur.id,
  );
  return getTeamRun(storyId)!;
}

// ---- story file registry (conflict detection) ----

export function addStoryFiles(storyId: string, paths: string[]): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO story_files (story_id, path) VALUES (?, ?)');
  for (const p of paths) {
    if (p) stmt.run(storyId, p);
  }
}

export function storyFiles(storyId: string): string[] {
  const rows = db.prepare('SELECT path FROM story_files WHERE story_id = ?').all(storyId) as { path: string }[];
  return rows.map((r) => r.path);
}

export function activeStoryScopes(excludeStoryId: string): { storyId: string; title: string; files: string[] }[] {
  const stories = listStories().filter((s) => s.status === 'in_dev' && s.id !== excludeStoryId);
  return stories.map((s) => ({ storyId: s.id, title: s.title, files: storyFiles(s.id) }));
}

// ---- project profiles (onboarding) ----

export function getProfileRecord(projectId: string): ProjectProfileRecord {
  const r = db.prepare('SELECT * FROM project_profiles WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
  if (!r) {
    return { projectId, status: 'idle', profile: null, architecture: null, baseline: [], error: null, updatedAt: now() };
  }
  return {
    projectId: r.project_id as string,
    status: r.status as OnboardStatus,
    profile: r.profile_json ? (JSON.parse(r.profile_json as string) as ProjectProfile) : null,
    architecture: (r.architecture as string | null) ?? null,
    baseline: JSON.parse(r.baseline_json as string) as BaselineResult[],
    error: (r.error as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

function upsertProfileRow(projectId: string): void {
  db.prepare('INSERT OR IGNORE INTO project_profiles (project_id, status, baseline_json, updated_at) VALUES (?, ?, ?, ?)').run(projectId, 'idle', '[]', now());
}

export function setProfileStatus(projectId: string, status: OnboardStatus, error?: string): void {
  upsertProfileRow(projectId);
  db.prepare('UPDATE project_profiles SET status = ?, error = ?, updated_at = ? WHERE project_id = ?').run(status, error ?? null, now(), projectId);
}

export function saveProfile(projectId: string, profile: ProjectProfile): void {
  upsertProfileRow(projectId);
  db.prepare('UPDATE project_profiles SET profile_json = ?, updated_at = ? WHERE project_id = ?').run(JSON.stringify(profile), now(), projectId);
}

export function saveArchitecture(projectId: string, architecture: string): void {
  upsertProfileRow(projectId);
  db.prepare('UPDATE project_profiles SET architecture = ?, updated_at = ? WHERE project_id = ?').run(architecture, now(), projectId);
}

export function saveBaseline(projectId: string, baseline: BaselineResult[]): void {
  upsertProfileRow(projectId);
  db.prepare('UPDATE project_profiles SET baseline_json = ?, updated_at = ? WHERE project_id = ?').run(JSON.stringify(baseline), now(), projectId);
}

// ---- code index ----

export interface CodeIndexEntry {
  path: string;
  language: string;
  symbols: CodeSymbol[];
  imports: string[] | null;
  mtime: number;
  size: number;
}

export function upsertIndexEntry(
  projectId: string,
  filePath: string,
  language: string,
  symbols: CodeSymbol[],
  imports: string[],
  mtime: number,
  size: number,
): void {
  db.prepare(
    'INSERT INTO code_index (project_id, path, language, symbols_json, imports_json, mtime, size) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, path) DO UPDATE SET language = excluded.language, symbols_json = excluded.symbols_json, imports_json = excluded.imports_json, mtime = excluded.mtime, size = excluded.size',
  ).run(projectId, filePath, language, JSON.stringify(symbols), JSON.stringify(imports), mtime, size);
}

export function getIndexEntries(projectId: string): CodeIndexEntry[] {
  const rows = db.prepare('SELECT * FROM code_index WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
  return rows.map((r) => ({
    path: r.path as string,
    language: r.language as string,
    symbols: JSON.parse(r.symbols_json as string) as CodeSymbol[],
    imports: r.imports_json ? (JSON.parse(r.imports_json as string) as string[]) : null,
    mtime: Number(r.mtime),
    size: Number(r.size),
  }));
}

export function deleteIndexEntry(projectId: string, filePath: string): void {
  db.prepare('DELETE FROM code_index WHERE project_id = ? AND path = ?').run(projectId, filePath);
}

export function clearIndex(projectId: string): void {
  db.prepare('DELETE FROM code_index WHERE project_id = ?').run(projectId);
}

// ---- project documents ----

function mapDocument(r: Record<string, unknown>): ProjectDocument {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    docType: r.doc_type as DocumentType,
    slug: r.slug as string,
    title: r.title as string,
    status: r.status as DocumentStatus,
    content: (r.content as string) ?? '',
    summary: (r.summary as string) ?? '',
    version: Number(r.version ?? 0),
    source: (r.source as DocumentSource) ?? 'manual',
    sourceCommit: (r.source_commit as string | null) ?? null,
    generatedBy: (r.generated_by as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    autoUpdate: Boolean(r.auto_update),
    watchedGlobs: r.watched_globs ? (JSON.parse(r.watched_globs as string) as string[]) : [],
    pinned: Boolean(r.pinned),
    checksum: (r.checksum as string) ?? '',
    error: (r.error as string | null) ?? null,
    lastGeneratedAt: (r.last_generated_at as string | null) ?? null,
    lastSyncedAt: (r.last_synced_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function getDocument(id: string): ProjectDocument {
  const row = db.prepare('SELECT * FROM project_documents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`文档不存在：${id}`);
  return mapDocument(row);
}

export function getDocumentBySlug(projectId: string, docType: DocumentType, slug: string): ProjectDocument | null {
  const row = db
    .prepare('SELECT * FROM project_documents WHERE project_id = ? AND doc_type = ? AND slug = ?')
    .get(projectId, docType, slug) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : null;
}

export function listDocuments(projectId: string, includeArchived = false): ProjectDocument[] {
  const rows = db
    .prepare(
      `SELECT * FROM project_documents WHERE project_id = ? ${includeArchived ? '' : "AND status != 'archived'"} ORDER BY doc_type, slug`,
    )
    .all(projectId) as Record<string, unknown>[];
  return rows.map(mapDocument);
}

export function listDocumentSummaries(projectId: string): ProjectDocumentSummary[] {
  const rows = db
    .prepare(
      `SELECT d.*, (SELECT COUNT(*) FROM document_sections s WHERE s.document_id = d.id AND s.version = d.version) AS section_count
       FROM project_documents d
       WHERE d.project_id = ? AND d.status != 'archived'
       ORDER BY d.doc_type, d.slug`,
    )
    .all(projectId) as Record<string, unknown>[];
  return rows.map((r) => {
    const doc = mapDocument(r);
    return {
      id: doc.id,
      projectId: doc.projectId,
      docType: doc.docType,
      slug: doc.slug,
      title: doc.title,
      status: doc.status,
      summary: doc.summary,
      version: doc.version,
      source: doc.source,
      sourceCommit: doc.sourceCommit,
      autoUpdate: doc.autoUpdate,
      pinned: doc.pinned,
      sectionCount: Number(r.section_count ?? 0),
      lastSyncedAt: doc.lastSyncedAt,
      updatedAt: doc.updatedAt,
    };
  });
}

export interface DocumentInput {
  projectId: string;
  docType: DocumentType;
  slug: string;
  title: string;
  status?: DocumentStatus;
  content?: string;
  summary?: string;
  version?: number;
  source?: DocumentSource;
  sourceCommit?: string | null;
  generatedBy?: string | null;
  model?: string | null;
  autoUpdate?: boolean;
  watchedGlobs?: string[];
  pinned?: boolean;
  checksum?: string;
  error?: string | null;
  lastGeneratedAt?: string | null;
}

export function createDocument(input: DocumentInput): ProjectDocument {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO project_documents
      (id, project_id, doc_type, slug, title, status, content, summary, version, source, source_commit, generated_by, model, auto_update, watched_globs, pinned, checksum, error, last_generated_at, last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.docType,
    input.slug,
    input.title,
    input.status ?? 'draft',
    input.content ?? '',
    input.summary ?? '',
    input.version ?? 0,
    input.source ?? 'manual',
    input.sourceCommit ?? null,
    input.generatedBy ?? null,
    input.model ?? null,
    input.autoUpdate ? 1 : 0,
    JSON.stringify(input.watchedGlobs ?? []),
    input.pinned ? 1 : 0,
    input.checksum ?? '',
    input.error ?? null,
    input.lastGeneratedAt ?? null,
    ts,
    ts,
  );
  return getDocument(id);
}

export interface DocumentPatch {
  title?: string;
  status?: DocumentStatus;
  content?: string;
  summary?: string;
  version?: number;
  source?: DocumentSource;
  sourceCommit?: string | null;
  generatedBy?: string | null;
  model?: string | null;
  autoUpdate?: boolean;
  watchedGlobs?: string[];
  pinned?: boolean;
  checksum?: string;
  error?: string | null;
  lastGeneratedAt?: string | null;
  lastSyncedAt?: string | null;
}

export function updateDocument(id: string, patch: DocumentPatch): ProjectDocument {
  const cur = getDocument(id);
  const ts = now();
  db.prepare(
    `UPDATE project_documents SET title = ?, status = ?, content = ?, summary = ?, version = ?, source = ?,
      source_commit = ?, generated_by = ?, model = ?, auto_update = ?, watched_globs = ?, pinned = ?, checksum = ?,
      error = ?, last_generated_at = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.title ?? cur.title,
    patch.status ?? cur.status,
    patch.content ?? cur.content,
    patch.summary ?? cur.summary,
    patch.version ?? cur.version,
    patch.source ?? cur.source,
    patch.sourceCommit !== undefined ? patch.sourceCommit : cur.sourceCommit,
    patch.generatedBy !== undefined ? patch.generatedBy : cur.generatedBy,
    patch.model !== undefined ? patch.model : cur.model,
    patch.autoUpdate !== undefined ? (patch.autoUpdate ? 1 : 0) : cur.autoUpdate ? 1 : 0,
    JSON.stringify(patch.watchedGlobs ?? cur.watchedGlobs),
    patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : cur.pinned ? 1 : 0,
    patch.checksum ?? cur.checksum,
    patch.error !== undefined ? patch.error : cur.error,
    patch.lastGeneratedAt !== undefined ? patch.lastGeneratedAt : cur.lastGeneratedAt,
    patch.lastSyncedAt !== undefined ? patch.lastSyncedAt : cur.lastSyncedAt,
    ts,
    id,
  );
  return getDocument(id);
}

export function deleteDocument(id: string): void {
  db.prepare('DELETE FROM document_sections WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM document_sync_state WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM project_documents WHERE id = ?').run(id);
}

export interface DocumentVersionInput {
  documentId: string;
  version: number;
  content: string;
  summary?: string;
  sourceCommit?: string | null;
  model?: string | null;
  createdBy?: string;
}

export function addDocumentVersion(input: DocumentVersionInput): DocumentVersion {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO document_versions (id, document_id, version, content, summary, source_commit, model, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    input.documentId,
    input.version,
    input.content,
    input.summary ?? '',
    input.sourceCommit ?? null,
    input.model ?? null,
    input.createdBy ?? 'system',
    now(),
  );
  return getDocumentVersion(input.documentId, input.version);
}

export function getDocumentVersion(documentId: string, version: number): DocumentVersion {
  const r = db
    .prepare('SELECT * FROM document_versions WHERE document_id = ? AND version = ?')
    .get(documentId, version) as Record<string, unknown> | undefined;
  if (!r) throw new Error(`文档版本不存在：v${version}`);
  return {
    id: r.id as string,
    documentId: r.document_id as string,
    version: Number(r.version),
    content: r.content as string,
    summary: (r.summary as string) ?? '',
    sourceCommit: (r.source_commit as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    createdBy: (r.created_by as string) ?? 'system',
    createdAt: r.created_at as string,
  };
}

export function listDocumentVersions(documentId: string): DocumentVersion[] {
  const rows = db
    .prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC')
    .all(documentId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    documentId: r.document_id as string,
    version: Number(r.version),
    content: r.content as string,
    summary: (r.summary as string) ?? '',
    sourceCommit: (r.source_commit as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    createdBy: (r.created_by as string) ?? 'system',
    createdAt: r.created_at as string,
  }));
}

export function replaceDocumentSections(
  documentId: string,
  version: number,
  sections: { anchor: string; heading: string; headingPath: string; content: string; tokens: number }[],
): void {
  db.prepare('DELETE FROM document_sections WHERE document_id = ? AND version = ?').run(documentId, version);
  const stmt = db.prepare(
    'INSERT INTO document_sections (id, document_id, version, anchor, heading, heading_path, ordinal, content, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  sections.forEach((section, index) => {
    stmt.run(randomUUID(), documentId, version, section.anchor, section.heading, section.headingPath, index, section.content, section.tokens);
  });
}

export function listDocumentSections(documentId: string, version?: number): DocumentSection[] {
  const doc = getDocument(documentId);
  const at = version ?? doc.version;
  const rows = db
    .prepare('SELECT * FROM document_sections WHERE document_id = ? AND version = ? ORDER BY ordinal')
    .all(documentId, at) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    documentId: r.document_id as string,
    version: Number(r.version),
    anchor: r.anchor as string,
    heading: r.heading as string,
    headingPath: r.heading_path as string,
    ordinal: Number(r.ordinal),
    content: r.content as string,
    tokens: Number(r.tokens),
  }));
}

export interface DocumentSyncRecord {
  documentId: string;
  projectId: string;
  targetPath: string;
  checksum: string;
  syncedAt: string;
}

export function getDocumentSync(documentId: string): DocumentSyncRecord | null {
  const r = db.prepare('SELECT * FROM document_sync_state WHERE document_id = ?').get(documentId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    documentId: r.document_id as string,
    projectId: r.project_id as string,
    targetPath: r.target_path as string,
    checksum: r.checksum as string,
    syncedAt: r.synced_at as string,
  };
}

export function listDocumentSyncs(projectId: string): DocumentSyncRecord[] {
  const rows = db.prepare('SELECT * FROM document_sync_state WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
  return rows.map((r) => ({
    documentId: r.document_id as string,
    projectId: r.project_id as string,
    targetPath: r.target_path as string,
    checksum: r.checksum as string,
    syncedAt: r.synced_at as string,
  }));
}

export function saveDocumentSync(documentId: string, projectId: string, targetPath: string, checksum: string): void {
  const ts = now();
  db.prepare(
    `INSERT INTO document_sync_state (document_id, project_id, target_path, checksum, synced_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET project_id = excluded.project_id, target_path = excluded.target_path,
       checksum = excluded.checksum, synced_at = excluded.synced_at`,
  ).run(documentId, projectId, targetPath, checksum, ts);
  updateDocument(documentId, { lastSyncedAt: ts });
}

export function getDocumentJob(projectId: string, docType: DocumentType, slug: string): DocumentJob | null {
  const r = db
    .prepare('SELECT * FROM document_jobs WHERE project_id = ? AND doc_type = ? AND slug = ?')
    .get(projectId, docType, slug) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    projectId: r.project_id as string,
    docType: r.doc_type as DocumentType,
    slug: r.slug as string,
    status: r.status as DocumentJobStatus,
    startedAt: r.started_at as string,
    heartbeatAt: r.heartbeat_at as string,
    cancelRequested: Boolean(r.cancel_requested),
    error: (r.error as string | null) ?? null,
  };
}

export function startDocumentJob(projectId: string, docType: DocumentType, slug: string): DocumentJob {
  const ts = now();
  db.prepare(
    `INSERT INTO document_jobs (project_id, doc_type, slug, status, started_at, heartbeat_at, cancel_requested, error)
     VALUES (?, ?, ?, 'running', ?, ?, 0, NULL)
     ON CONFLICT(project_id, doc_type, slug) DO UPDATE SET status = 'running', started_at = excluded.started_at,
       heartbeat_at = excluded.heartbeat_at, cancel_requested = 0, error = NULL`,
  ).run(projectId, docType, slug, ts, ts);
  return getDocumentJob(projectId, docType, slug)!;
}

export function heartbeatDocumentJob(projectId: string, docType: DocumentType, slug: string): void {
  db.prepare(
    "UPDATE document_jobs SET heartbeat_at = ? WHERE project_id = ? AND doc_type = ? AND slug = ? AND status = 'running'",
  ).run(now(), projectId, docType, slug);
}

export function finishDocumentJob(
  projectId: string,
  docType: DocumentType,
  slug: string,
  status: DocumentJobStatus,
  error?: string,
): void {
  db.prepare(
    'UPDATE document_jobs SET status = ?, error = ?, heartbeat_at = ? WHERE project_id = ? AND doc_type = ? AND slug = ?',
  ).run(status, error ?? null, now(), projectId, docType, slug);
}

export function requestDocumentCancel(projectId: string, docType: DocumentType, slug: string): DocumentJob {
  db.prepare(
    "UPDATE document_jobs SET cancel_requested = 1, heartbeat_at = ? WHERE project_id = ? AND doc_type = ? AND slug = ? AND status = 'running'",
  ).run(now(), projectId, docType, slug);
  return (
    getDocumentJob(projectId, docType, slug) ?? {
      projectId,
      docType,
      slug,
      status: 'cancelled',
      startedAt: now(),
      heartbeatAt: now(),
      cancelRequested: true,
      error: null,
    }
  );
}

export function listRunningDocumentJobs(): DocumentJob[] {
  const rows = db.prepare("SELECT * FROM document_jobs WHERE status = 'running'").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    projectId: r.project_id as string,
    docType: r.doc_type as DocumentType,
    slug: r.slug as string,
    status: r.status as DocumentJobStatus,
    startedAt: r.started_at as string,
    heartbeatAt: r.heartbeat_at as string,
    cancelRequested: Boolean(r.cancel_requested),
    error: (r.error as string | null) ?? null,
  }));
}