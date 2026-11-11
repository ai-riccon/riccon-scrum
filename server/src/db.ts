import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  STORY_FLOW,
  type AgentRole,
  type AgentSession,
  type Approval,
  type ApprovalKind,
  type ApprovalStatus,
  type BaselineResult,
  type CodeSymbol,
  type DodCommand,
  type DodItem,
  type DodStatus,
  type EventPayload,
  type EventRow,
  type OnboardStatus,
  type Project,
  type ProjectProfile,
  type ProjectProfileRecord,
  type SessionStatus,
  type Story,
  type StoryStatus,
  type TeamPhase,
  type TeamPlanTask,
  type TeamRun,
  type TeamVerdict,
} from '@acp-scrum/shared';

const DATA_DIR = path.resolve(import.meta.dirname, '../data');
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
  status TEXT NOT NULL DEFAULT 'pending',
  evidence TEXT,
  updated_at TEXT NOT NULL
);
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
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (project_id, path)
);
`);

function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('projects', 'agent_kind', "agent_kind TEXT NOT NULL DEFAULT 'opencode'");
ensureColumn('projects', 'team_mode', 'team_mode INTEGER NOT NULL DEFAULT 0');
ensureColumn('agent_sessions', 'role', "role TEXT NOT NULL DEFAULT 'solo'");

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
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO projects (id, workspace_id, name, repo_path, default_branch, dod_commands, agent_kind, team_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(p.id, p.workspaceId, p.name, p.repoPath, p.defaultBranch, JSON.stringify(p.dodCommands), p.agentKind, p.teamMode ? 1 : 0, p.createdAt);
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
    createdAt: r.created_at as string,
  };
}

export function updateProjectSettings(id: string, patch: { agentKind?: string; teamMode?: boolean }): Project {
  const cur = getProject(id);
  const agentKind = patch.agentKind ?? cur.agentKind;
  const teamMode = patch.teamMode ?? cur.teamMode;
  db.prepare('UPDATE projects SET agent_kind = ?, team_mode = ? WHERE id = ?').run(agentKind, teamMode ? 1 : 0, id);
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
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createStory(input: {
  projectId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
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
    createdAt: now(),
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO stories (id, project_id, title, description, acceptance_criteria, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(s.id, s.projectId, s.title, s.description, s.acceptanceCriteria, s.status, s.createdAt, s.updatedAt);
  for (const cmd of project.dodCommands) {
    createDodItem(s.id, cmd.kind, cmd.label, cmd.command);
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

// ---- dod items ----

function mapDod(r: Record<string, unknown>): DodItem {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    kind: r.kind as string,
    label: r.label as string,
    command: (r.command as string | null) ?? null,
    status: r.status as DodStatus,
    evidence: (r.evidence as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function createDodItem(storyId: string, kind: string, label: string, command: string | null): DodItem {
  const item: DodItem = {
    id: randomUUID(),
    storyId,
    kind,
    label,
    command,
    status: 'pending',
    evidence: null,
    updatedAt: now(),
  };
  db.prepare(
    'INSERT INTO dod_items (id, story_id, kind, label, command, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(item.id, item.storyId, item.kind, item.label, item.command, item.status, item.updatedAt);
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

// ---- agent sessions ----

function mapSession(r: Record<string, unknown>): AgentSession {
  return {
    id: r.id as string,
    storyId: r.story_id as string,
    agentKind: r.agent_kind as string,
    role: ((r.role as string) ?? 'solo') as AgentRole,
    acpSessionId: (r.acp_session_id as string | null) ?? null,
    pid: (r.pid as number | null) ?? null,
    status: r.status as SessionStatus,
    createdAt: r.created_at as string,
  };
}

export function createSession(storyId: string, agentKind = 'opencode', role: AgentRole = 'solo'): AgentSession {
  const s: AgentSession = {
    id: randomUUID(),
    storyId,
    agentKind,
    role,
    acpSessionId: null,
    pid: null,
    status: 'starting',
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO agent_sessions (id, story_id, agent_kind, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(s.id, s.storyId, s.agentKind, s.role, s.status, s.createdAt);
  return s;
}

export function updateSession(
  id: string,
  patch: { acpSessionId?: string; pid?: number; status?: SessionStatus },
): AgentSession {
  const cur = getSession(id);
  const next = {
    acpSessionId: patch.acpSessionId ?? cur.acpSessionId,
    pid: patch.pid ?? cur.pid,
    status: patch.status ?? cur.status,
  };
  db.prepare('UPDATE agent_sessions SET acp_session_id = ?, pid = ?, status = ? WHERE id = ?').run(next.acpSessionId, next.pid, next.status, id);
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
  mtime: number;
  size: number;
}

export function upsertIndexEntry(projectId: string, filePath: string, language: string, symbols: CodeSymbol[], mtime: number, size: number): void {
  db.prepare(
    'INSERT INTO code_index (project_id, path, language, symbols_json, mtime, size) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, path) DO UPDATE SET language = excluded.language, symbols_json = excluded.symbols_json, mtime = excluded.mtime, size = excluded.size',
  ).run(projectId, filePath, language, JSON.stringify(symbols), mtime, size);
}

export function getIndexEntries(projectId: string): CodeIndexEntry[] {
  const rows = db.prepare('SELECT * FROM code_index WHERE project_id = ?').all(projectId) as Record<string, unknown>[];
  return rows.map((r) => ({
    path: r.path as string,
    language: r.language as string,
    symbols: JSON.parse(r.symbols_json as string) as CodeSymbol[],
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