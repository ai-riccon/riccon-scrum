import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ApprovalStatus,
  ChangeImpactItem,
  DodCommand,
  DocumentType,
  KnowledgeKind,
  RequirementIntake,
  RequirementSplitChild,
  TaxonomyProposal,
} from '@riccon-scrum/shared';
import {
  acceptanceForStory,
  addKnowledge,
  categoryScopeIds,
  createCategory,
  createProject,
  createRequirement,
  createStory,
  createTag,
  deleteCategory,
  deleteDependency,
  deleteProject,
  deleteTag,
  entityIdsForTag,
  dodItemsForStory,
  eventsAfter,
  getBugReport,
  getChangeRequest,
  getDocument,
  getDocumentJob,
  getDocumentSync,
  getProfileRecord,
  getProject,
  getHandoff,
  getRequirement,
  getRequirementJob,
  getStory,
  getTeamRun,
  deleteKnowledge,
  listApprovals,
  listCategories,
  listDependencies,
  listDocumentSections,
  listKnowledge,
  listProjects,
  listRequirementFeedback,
  listRequirements,
  listRequirementVersions,
  listStories,
  listTags,
  recentEvents,
  renameCategory,
  sessionsForStory,
  setEntityTags,
  storyTaskMetrics,
  storyTaskSummaries,
  setRequirementCategory,
  setStoryCategory,
  setProjectArchived,
  setProjectDefaultBranch,
  tagsByEntity,
  tagsForEntity,
  updateProjectSettings,
} from './db';
import { initRepo, repoState, switchBranch } from './git';
import { manager } from './acp/manager';
import { AGENT_KINDS } from './acp/agents';
import { acceptStory, approveStory, reworkStory, resumeStory, startStory, storyDiff } from './service';
import { summarizeDiff } from './ops';
import { releaseStatus, releaseStory, rollbackStory } from './release';
import {
  approveRequirement,
  archiveRequirement,
  cancelRequirementGeneration,
  generateRequirementDraft,
  isGenerating,
  submitRequirementFeedback,
} from './discovery';
import {
  closeIntakeSession,
  confirmIntake,
  getRequirementConversation,
  isIntakeTurnRunning,
  sendIntakeMessage,
  startIntakeConversation,
} from './intake';
import { getGlobalSettings, updateGlobalSettings } from './settings';
import type { GlobalSettings } from '@riccon-scrum/shared';
import { onboardProject } from './onboard';
import { indexProject, searchCode } from './indexer';
import { getIndexEntries } from './db';
import { computeMetrics, computeQualityMetrics, computeRequirementMetrics } from './metrics';
import {
  buildDependencyGraph,
  createDependency,
  ensureStoryHandoff,
  removeDependency,
  storyDependencyInfo,
} from './dependencies';
import { confirmSplit, generateSplitDraft, getSplitDraft } from './split';
import { applyTaxonomy, generateTaxonomy } from './taxonomy';
import { searchEntities } from './semantic';
import { suggestDependencies } from './dependency-suggest';
import { buildStoryTaskPlan, planStoryTasks, replanRemainingTasks, updateTaskPlanTask } from './task-plan';
import { retryStoryTask, skipStoryTask } from './task-runner';
import { buildStoryContext } from './context';
import {
  analyzeChangeRequest,
  changeMetrics,
  createRequirementChangeRequest,
  decideChangeRequest,
  listRequirementChangeRequests,
  materializeChangeRequest,
  updateImpactAction,
} from './changes';
import {
  acceptBug,
  bugMetrics,
  bugs,
  closeBug,
  rejectBug,
  reopenBug,
  reportBug,
  suggestBugTriage,
  triageBug,
  verifyBug,
} from './bugs';
import {
  applyDocumentSync,
  DOCUMENT_META,
  documentConsistency,
  documentImpact,
  documentMetrics,
  documentTypeLabel,
  documentVersions,
  editDocument,
  ensureDocument,
  generateCodeGraphDocument,
  generateOverviewDocument,
  generateRequirementDocuments,
  listProjectDocuments,
  previewDocumentSync,
  publishDocument,
  refreshProjectDocuments,
  rollbackDocument,
  setDocumentPinned,
} from './documents';
import { cancelDocumentGeneration, generateAgentDocument, generateLegacyRequirementsBaseline } from './document-generator';

function filesystemRoots(): string[] {
  if (process.platform !== 'win32') return ['/'];
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fsSync.existsSync(drive)) roots.push(drive);
  }
  return roots;
}

async function browseDirectories(rawPath?: string) {
  const target = path.resolve(rawPath?.trim() || os.homedir());
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`目录不存在：${target}`);
  let dirents;
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch (err) {
    throw new Error(`无法读取目录：${err instanceof Error ? err.message : String(err)}`);
  }
  const all = dirents
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const full = path.join(target, entry.name);
      return { name: entry.name, path: full, isGitRepo: fsSync.existsSync(path.join(full, '.git')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    roots: filesystemRoots(),
    entries: all.slice(0, 400),
    isGitRepo: fsSync.existsSync(path.join(target, '.git')),
    truncated: all.length > 400,
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async (req) => {
    const { includeArchived } = req.query as { includeArchived?: string };
    return listProjects(includeArchived === '1' || includeArchived === 'true');
  });

  app.get('/api/settings', async () => ({ global: getGlobalSettings(), agentKinds: AGENT_KINDS }));

  app.put('/api/settings', async (req) => updateGlobalSettings(req.body as Partial<GlobalSettings>));

  app.post('/api/projects', async (req) => {
    const body = req.body as {
      name: string;
      repoPath: string;
      defaultBranch?: string;
      dodCommands?: DodCommand[];
      agentKind?: string;
      teamMode?: boolean;
      model?: string;
      discoveryModel?: string;
      glossary?: string;
      requireMachineDod?: boolean;
      autoApproveReads?: boolean;
      autoApproveCommands?: string[];
    };
    const global = getGlobalSettings();
    const repo = await repoState(body.repoPath).catch(() => null);
    return createProject({
      ...body,
      defaultBranch: body.defaultBranch ?? repo?.branch ?? 'main',
      agentKind: body.agentKind ?? global.defaultAgentKind,
      requireMachineDod: body.requireMachineDod ?? global.requireMachineDod,
    });
  });

  app.get('/api/projects/:id/git', async (req) => {
    const { id } = req.params as { id: string };
    return repoState(getProject(id).repoPath);
  });

  app.post('/api/projects/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    const project = getProject(id);
    if (project.archived) return project;
    if (listStories(id).some((story) => story.status === 'in_dev')) {
      throw new Error('项目仍有开发中的故事，请先完成或终止后再归档');
    }
    if (!listProjects().some((item) => item.id !== id)) throw new Error('至少保留一个未归档项目');
    return setProjectArchived(id, true);
  });

  app.post('/api/projects/:id/unarchive', async (req) => {
    const { id } = req.params as { id: string };
    return setProjectArchived(id, false);
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteProject(id);
    return { ok: true };
  });

  app.post('/api/projects/:id/git/init', async (req) => {
    const { id } = req.params as { id: string };
    const project = getProject(id);
    await initRepo(project.repoPath);
    const state = await repoState(project.repoPath);
    if (state.branch) setProjectDefaultBranch(id, state.branch);
    return state;
  });

  app.post('/api/projects/:id/git/checkout', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { branch?: string };
    const branch = body.branch?.trim();
    if (!branch) throw new Error('请提供要切换的分支名');
    const project = getProject(id);
    await switchBranch(project.repoPath, branch);
    setProjectDefaultBranch(id, branch);
    return repoState(project.repoPath);
  });

  app.get('/api/fs/dirs', async (req) => {
    const { path: dirPath } = req.query as { path?: string };
    return browseDirectories(dirPath);
  });

  app.post('/api/projects/:id/settings', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      agentKind?: string;
      teamMode?: boolean;
      model?: string;
      discoveryModel?: string;
      glossary?: string;
      requireMachineDod?: boolean;
      autoApproveReads?: boolean;
      autoApproveCommands?: string[];
      dodCommands?: DodCommand[];
    };
    return updateProjectSettings(id, body);
  });

  app.post('/api/projects/:id/onboard', async (req) => {
    const { id } = req.params as { id: string };
    const current = getProfileRecord(id);
    if (['scanning', 'analyzing', 'baselining'].includes(current.status)) {
      throw new Error('onboarding already in progress');
    }
    void onboardProject(id);
    return { status: 'started' };
  });

  app.get('/api/projects/:id/profile', async (req) => {
    const { id } = req.params as { id: string };
    return getProfileRecord(id);
  });

  app.post('/api/projects/:id/index', async (req) => {
    const { id } = req.params as { id: string };
    const project = getProject(id);
    return indexProject(id, project.repoPath);
  });

  app.get('/api/projects/:id/knowledge', async (req) => {
    const { id } = req.params as { id: string };
    return listKnowledge(id);
  });

  app.post('/api/projects/:id/knowledge', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { kind?: KnowledgeKind; title: string; content: string; tags?: string };
    return addKnowledge({
      projectId: id,
      kind: body.kind ?? 'standard',
      title: body.title,
      content: body.content,
      tags: body.tags,
    });
  });

  app.delete('/api/knowledge/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteKnowledge(id);
    return { ok: true };
  });

  app.get('/api/projects/:id/index', async (req) => {
    const { id } = req.params as { id: string };
    const entries = getIndexEntries(id);
    return { files: entries.length, symbols: entries.reduce((n, e) => n + e.symbols.length, 0) };
  });

  app.get('/api/search/entities', async (req) => {
    const { projectId, q, limit } = req.query as { projectId: string; q?: string; limit?: string };
    return searchEntities(projectId, q ?? '', Number(limit ?? 12));
  });

  app.get('/api/projects/:id/search', async (req) => {
    const { id } = req.params as { id: string };
    const { q } = req.query as { q?: string };
    const project = getProject(id);
    return searchCode(id, project.repoPath, q ?? '');
  });

  app.get('/api/metrics', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return computeMetrics(projectId);
  });

  app.get('/api/metrics/quality', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return computeQualityMetrics(projectId);
  });

  app.get('/api/metrics/tasks', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return storyTaskMetrics(projectId);
  });

  app.get('/api/categories', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return listCategories(projectId);
  });

  app.post('/api/categories', async (req) => {
    const body = req.body as { projectId: string; name: string; parentId?: string | null };
    return createCategory(body);
  });

  app.put('/api/categories/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name: string };
    return renameCategory(id, body.name);
  });

  app.delete('/api/categories/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteCategory(id);
    return { ok: true };
  });

  app.post('/api/taxonomy/preview', async (req) => {
    const body = req.body as { projectId: string };
    return generateTaxonomy(body.projectId);
  });

  app.post('/api/taxonomy/apply', async (req) => {
    const body = req.body as { projectId: string; proposal: TaxonomyProposal };
    return applyTaxonomy(body.projectId, body.proposal);
  });

  app.get('/api/tags', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return listTags(projectId);
  });

  app.post('/api/tags', async (req) => {
    const body = req.body as { projectId: string; name: string; color?: string };
    return createTag(body);
  });

  app.delete('/api/tags/:id', async (req) => {
    const { id } = req.params as { id: string };
    deleteTag(id);
    return { ok: true };
  });

  app.put('/api/requirements/:id/tags', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tagIds?: string[] };
    return setEntityTags('requirement', id, body.tagIds ?? []);
  });

  app.put('/api/stories/:id/tags', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tagIds?: string[] };
    return setEntityTags('story', id, body.tagIds ?? []);
  });

  app.post('/api/dependencies/suggest', async (req) => {
    const body = req.body as { projectId: string; entityType: 'requirement' | 'story'; entityId: string };
    return suggestDependencies(body);
  });

  app.get('/api/dependencies', async (req) => {
    const { projectId, type } = req.query as { projectId: string; type?: 'requirement' | 'story' };
    return listDependencies(projectId, type);
  });

  app.post('/api/dependencies', async (req) => {
    const body = req.body as {
      projectId: string;
      predecessorType: 'requirement' | 'story';
      predecessorId: string;
      successorType: 'requirement' | 'story';
      successorId: string;
      note?: string | null;
    };
    return createDependency(body);
  });

  app.delete('/api/dependencies/:id', async (req) => {
    const { id } = req.params as { id: string };
    removeDependency(id);
    return { ok: true };
  });

  app.get('/api/graph', async (req) => {
    const { projectId, type, requirementId } = req.query as {
      projectId: string;
      type?: 'requirement' | 'story';
      requirementId?: string;
    };
    return buildDependencyGraph(projectId, type ?? 'requirement', { requirementId: requirementId ?? null });
  });

  app.get('/api/requirements', async (req) => {
    const { projectId, categoryId, tagId } = req.query as {
      projectId?: string;
      categoryId?: string;
      tagId?: string;
    };
    let requirements = listRequirements(projectId);
    if (projectId && categoryId) {
      const scope = new Set(categoryScopeIds(projectId, categoryId));
      requirements = requirements.filter((r) => r.categoryId && scope.has(r.categoryId));
    }
    if (projectId && tagId) {
      const ids = new Set(entityIdsForTag(projectId, 'requirement', tagId));
      requirements = requirements.filter((r) => ids.has(r.id));
    }
    if (!projectId) return requirements.map((r) => ({ ...r, tags: tagsForEntity('requirement', r.id) }));
    const tagMap = tagsByEntity(projectId, 'requirement');
    return requirements.map((r) => ({ ...r, tags: tagMap.get(r.id) ?? [] }));
  });

  app.post('/api/requirements', async (req) => {
    const body = req.body as {
      projectId: string;
      title: string;
      rawInput: string;
      intake?: Partial<RequirementIntake> | null;
      source?: string;
      parentRequirementId?: string | null;
    };
    return createRequirement(body);
  });

  app.post('/api/requirements/intake', async (req) => {
    const body = req.body as { projectId: string; message: string };
    return startIntakeConversation(body.projectId, body.message);
  });

  app.post('/api/requirements/:id/intake', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { message: string };
    return { message: sendIntakeMessage(id, body.message) };
  });

  app.post('/api/requirements/:id/intake/confirm', async (req) => {
    const { id } = req.params as { id: string };
    confirmIntake(id);
    return { status: 'started' };
  });

  app.post('/api/feedback', async (req) => {
    const body = req.body as { projectId: string; title: string; description: string; severity?: string };
    return createRequirement({
      projectId: body.projectId,
      title: body.title,
      rawInput: `[生产反馈${body.severity ? `/${body.severity}` : ''}]\n${body.description}`,
      source: 'production',
    });
  });

  app.get('/api/requirements/:id/change-requests', async (req) => {
    const { id } = req.params as { id: string };
    return listRequirementChangeRequests(undefined, id);
  });

  app.post('/api/requirements/:id/change-requests', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      title: string;
      reason: string;
      changeType: 'corrective' | 'adaptive' | 'perfective';
      source?: 'production' | 'review' | 'bug' | 'manual' | 'external';
      iteration?: string | null;
      externalId?: string | null;
      externalUrl?: string | null;
    };
    return createRequirementChangeRequest({
      requirementId: id,
      title: body.title,
      reason: body.reason,
      changeType: body.changeType,
      source: body.source ?? 'manual',
      iteration: body.iteration,
      externalId: body.externalId,
      externalUrl: body.externalUrl,
    });
  });

  app.get('/api/change-requests', async (req) => {
    const { projectId, status, iteration } = req.query as { projectId?: string; status?: string; iteration?: string };
    return listRequirementChangeRequests(projectId, undefined).filter(
      (item) => (!status || item.status === status) && (!iteration || item.iteration === iteration),
    );
  });

  app.get('/api/change-requests/:id', async (req) => {
    const { id } = req.params as { id: string };
    return getChangeRequest(id);
  });

  app.post('/api/change-requests/import', async (req) => {
    const body = req.body as {
      requirementId: string;
      title: string;
      reason: string;
      changeType: 'corrective' | 'adaptive' | 'perfective';
      iteration?: string | null;
      externalId?: string | null;
      externalUrl?: string | null;
    };
    return createRequirementChangeRequest({
      requirementId: body.requirementId,
      title: body.title,
      reason: body.reason,
      changeType: body.changeType,
      source: 'external',
      iteration: body.iteration,
      externalId: body.externalId,
      externalUrl: body.externalUrl,
    });
  });

  app.post('/api/change-requests/:id/analyze', async (req) => {
    const { id } = req.params as { id: string };
    return analyzeChangeRequest(id);
  });

  app.post('/api/change-requests/:id/decide', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status: 'approved' | 'rejected'; decision?: 'revision' | 'increment'; decidedBy?: string };
    return decideChangeRequest(id, body);
  });

  app.post('/api/change-requests/:id/materialize', async (req) => {
    const { id } = req.params as { id: string };
    return materializeChangeRequest(id);
  });

  app.patch('/api/change-requests/:id/impact/:storyId', async (req) => {
    const { id, storyId } = req.params as { id: string; storyId: string };
    const body = req.body as { action: 'keep' | 'adjust' | 'rework' | 'add_increment' | 'add_regression' };
    return updateImpactAction(id, storyId, body.action);
  });

  app.get('/api/metrics/changes', async (req) => {
    const { projectId, iteration } = req.query as { projectId?: string; iteration?: string };
    return changeMetrics(projectId, iteration);
  });

  // 兼容旧入口：内部改为 ChangeRequest + analyze + increment + materialize，不再创建需求子节点。
  app.post('/api/requirements/:id/change-request', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { title: string; rawInput: string };
    const changeRequest = createRequirementChangeRequest({
      requirementId: id,
      title: body.title,
      reason: body.rawInput,
      changeType: 'perfective',
      source: 'manual',
    });
    const analyzed = analyzeChangeRequest(changeRequest.id);
    decideChangeRequest(changeRequest.id, { status: 'approved', decision: 'increment' });
    const result = materializeChangeRequest(changeRequest.id);
    return { requirement: result.requirement, impact: analyzed.impact };
  });

  app.get('/api/requirements/metrics', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return computeRequirementMetrics(projectId);
  });

  app.get('/api/requirements/:id', async (req) => {
    const { id } = req.params as { id: string };
    const requirement = getRequirement(id);
    return {
      requirement: { ...requirement, tags: tagsForEntity('requirement', id) },
      versions: listRequirementVersions(id),
      feedback: listRequirementFeedback(id),
      conversation: getRequirementConversation(id),
      children: listRequirements(requirement.projectId).filter((r) => r.parentRequirementId === id),
      dependencies: listDependencies(requirement.projectId, 'requirement').filter(
        (d) => d.successorId === id || d.predecessorId === id,
      ),
      generating: isGenerating(id),
      job: getRequirementJob(id),
    };
  });

  app.post('/api/requirements/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    return cancelRequirementGeneration(id);
  });

  app.post('/api/requirements/:id/generate', async (req) => {
    const { id } = req.params as { id: string };
    if (isGenerating(id)) throw new Error('该需求正在生成中，请稍候');
    if (isIntakeTurnRunning(id)) throw new Error('需求澄清进行中，请稍候');
    await closeIntakeSession(id);
    void generateRequirementDraft(id).catch((err) => console.error('[discovery]', err));
    return { status: 'started' };
  });

  app.post('/api/requirements/:id/feedback', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      comment?: string;
      decisions?: { storyKey?: string | null; decision: 'approve' | 'reject' | 'comment' | 'edit'; comment?: string }[];
    };
    const feedback = submitRequirementFeedback(id, body);
    void generateRequirementDraft(id).catch((err) => console.error('[discovery]', err));
    return { feedback, status: 'revising' };
  });

  app.post('/api/requirements/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    return approveRequirement(id);
  });

  app.get('/api/requirements/:id/split/draft', async (req) => {
    const { id } = req.params as { id: string };
    return getSplitDraft(id);
  });

  app.post('/api/requirements/:id/split/draft', async (req) => {
    const { id } = req.params as { id: string };
    return generateSplitDraft(id);
  });

  app.post('/api/requirements/:id/split/confirm', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { children?: RequirementSplitChild[] };
    return confirmSplit(id, body.children);
  });

  app.post('/api/requirements/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    await closeIntakeSession(id);
    return archiveRequirement(id);
  });

  app.get('/api/stories', async (req) => {
    const { projectId, categoryId, tagId } = req.query as {
      projectId?: string;
      categoryId?: string;
      tagId?: string;
    };
    let stories = listStories(projectId);
    if (projectId && categoryId) {
      const scope = new Set(categoryScopeIds(projectId, categoryId));
      stories = stories.filter((s) => s.categoryId && scope.has(s.categoryId));
    }
    if (projectId && tagId) {
      const ids = new Set(entityIdsForTag(projectId, 'story', tagId));
      stories = stories.filter((s) => ids.has(s.id));
    }
    const tagMap = projectId ? tagsByEntity(projectId, 'story') : null;
    const taskMap = storyTaskSummaries(projectId);
    return stories.map((s) => ({
      ...s,
      tags: tagMap ? tagMap.get(s.id) ?? [] : tagsForEntity('story', s.id),
      dod: dodItemsForStory(s.id),
      acceptance: acceptanceForStory(s.id),
      tasks: taskMap.get(s.id) ?? null,
    }));
  });

  app.post('/api/stories', async (req) => {
    const body = req.body as { projectId: string; title: string; description?: string; acceptanceCriteria?: string };
    return createStory(body);
  });

  app.get('/api/stories/:id', async (req) => {
    const { id } = req.params as { id: string };
    const story = getStory(id);
    return {
      story: { ...story, tags: tagsForEntity('story', id) },
      dod: dodItemsForStory(id),
      acceptance: acceptanceForStory(id),
      sessions: sessionsForStory(id),
      dependencies: storyDependencyInfo(id),
      taskPlan: buildStoryTaskPlan(id),
      bugs: bugs(undefined, undefined, id),
    };
  });

  app.get('/api/stories/:id/bugs', async (req) => {
    const { id } = req.params as { id: string };
    return bugs(undefined, undefined, id);
  });

  app.post('/api/stories/:id/bugs', async (req) => {
    const { id } = req.params as { id: string };
    return reportBug(id, req.body as {
      title: string;
      description?: string;
      steps: string;
      expected: string;
      actual: string;
      acIds?: string[];
      environment?: string;
      evidence?: string[];
      severity?: 'blocker' | 'critical' | 'major' | 'minor';
      priority?: 'P0' | 'P1' | 'P2' | 'P3';
      reproducibility?: 'always' | 'often' | 'sometimes' | 'once';
      reporter?: string;
      externalId?: string | null;
      externalUrl?: string | null;
    });
  });

  app.get('/api/bugs', async (req) => {
    const { projectId, status, storyId } = req.query as {
      projectId?: string;
      status?: 'new' | 'triaged' | 'accepted' | 'rejected' | 'duplicate' | 'fixing' | 'fixed' | 'verified' | 'closed' | 'reopened';
      storyId?: string;
    };
    return bugs(projectId, status, storyId);
  });

  app.get('/api/bugs/:id/suggest', async (req) => {
    const { id } = req.params as { id: string };
    return suggestBugTriage(id);
  });

  app.get('/api/bugs/:id', async (req) => {
    const { id } = req.params as { id: string };
    return getBugReport(id);
  });

  app.post('/api/bugs/import', async (req) => {
    const body = req.body as {
      storyId: string;
      title: string;
      description?: string;
      steps: string;
      expected: string;
      actual: string;
      environment?: string;
      severity?: 'blocker' | 'critical' | 'major' | 'minor';
      priority?: 'P0' | 'P1' | 'P2' | 'P3';
      reproducibility?: 'always' | 'often' | 'sometimes' | 'once';
      externalId?: string | null;
      externalUrl?: string | null;
    };
    return reportBug(body.storyId, { ...body, reporter: 'external' });
  });

  app.post('/api/bugs/:id/triage', async (req) => {
    const { id } = req.params as { id: string };
    return triageBug(id, req.body as {
      severity?: 'blocker' | 'critical' | 'major' | 'minor';
      priority?: 'P0' | 'P1' | 'P2' | 'P3';
      reproducibility?: 'always' | 'often' | 'sometimes' | 'once';
      acIds?: string[];
      duplicateOf?: string | null;
      triageNote?: string | null;
    });
  });

  app.post('/api/bugs/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { regressionTest?: string; strategy?: 'auto' | 'rework' | 'fix_story' };
    return acceptBug(id, body);
  });

  app.post('/api/bugs/:id/reject', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { reason?: string };
    return rejectBug(id, body.reason ?? '');
  });

  app.post('/api/bugs/:id/verify', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { resolution?: string };
    return verifyBug(id, body.resolution);
  });

  app.post('/api/bugs/:id/close', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { resolution?: string };
    return closeBug(id, body.resolution);
  });

  app.post('/api/bugs/:id/reopen', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { reason?: string };
    return reopenBug(id, body.reason ?? '');
  });

  app.get('/api/metrics/bugs', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return bugMetrics(projectId);
  });

  app.get('/api/stories/:id/tasks', async (req) => {
    const { id } = req.params as { id: string };
    return buildStoryTaskPlan(id);
  });

  app.get('/api/stories/:id/context', async (req) => {
    const { id } = req.params as { id: string };
    const { taskId } = req.query as { taskId?: string };
    return { context: buildStoryContext(id, taskId ?? null) };
  });

  app.post('/api/stories/:id/tasks/plan', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { force?: boolean };
    return planStoryTasks(id, { force: Boolean(body.force) });
  });

  app.post('/api/stories/:id/tasks/replan', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { failure?: string };
    return replanRemainingTasks(id, body.failure ?? '');
  });

  app.patch('/api/stories/:id/tasks/:taskId', async (req) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    const body = req.body as {
      title?: string;
      description?: string;
      files?: string[];
      acIds?: string[];
      verifyCommand?: string | null;
      dependsOnKeys?: string[];
    };
    return updateTaskPlanTask(id, taskId, body);
  });

  app.post('/api/stories/:id/tasks/:taskId/retry', async (req) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    return retryStoryTask(id, taskId);
  });

  app.post('/api/stories/:id/tasks/:taskId/skip', async (req) => {
    const { id, taskId } = req.params as { id: string; taskId: string };
    const body = req.body as { reason?: string };
    return skipStoryTask(id, taskId, body.reason ?? '');
  });

  app.get('/api/stories/:id/dependencies', async (req) => {
    const { id } = req.params as { id: string };
    return storyDependencyInfo(id);
  });

  app.get('/api/stories/:id/handoff', async (req) => {
    const { id } = req.params as { id: string };
    return ensureStoryHandoff(id) ?? getHandoff('story', id);
  });

  app.put('/api/requirements/:id/category', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { categoryId?: string | null };
    return setRequirementCategory(id, body.categoryId ?? null);
  });

  app.put('/api/stories/:id/category', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { categoryId?: string | null };
    return setStoryCategory(id, body.categoryId ?? null);
  });

  app.get('/api/stories/:id/dod', async (req) => {
    const { id } = req.params as { id: string };
    return dodItemsForStory(id);
  });

  app.get('/api/stories/:id/team', async (req) => {
    const { id } = req.params as { id: string };
    return { run: getTeamRun(id), sessions: sessionsForStory(id), tasks: buildStoryTaskPlan(id) };
  });

  app.get('/api/stories/:id/diff', async (req) => {
    const { id } = req.params as { id: string };
    const diff = await storyDiff(id);
    return { diff, ...summarizeDiff(diff) };
  });

  app.post('/api/stories/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    return approveStory(id);
  });

  app.post('/api/stories/:id/start', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { override?: boolean; reason?: string };
    return startStory(id, { override: Boolean(body.override), reason: body.reason });
  });

  app.post('/api/stories/:id/rework', async (req) => {
    const { id } = req.params as { id: string };
    return reworkStory(id);
  });

  app.post('/api/stories/:id/resume', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { message?: string };
    const message = body.message?.trim();
    if (!message) throw new Error('请提供继续/返工指令，说明本轮要完成或修改什么');
    return resumeStory(id, message);
  });

  app.post('/api/stories/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    return acceptStory(id);
  });

  app.get('/api/stories/:id/release', async (req) => {
    const { id } = req.params as { id: string };
    return releaseStatus(id);
  });

  app.post('/api/stories/:id/release', async (req) => {
    const { id } = req.params as { id: string };
    return releaseStory(id);
  });

  app.post('/api/stories/:id/rollback', async (req) => {
    const { id } = req.params as { id: string };
    return rollbackStory(id);
  });

  app.get('/api/approvals', async (req) => {
    const { status } = req.query as { status?: ApprovalStatus };
    return listApprovals(status);
  });

  app.post('/api/approvals/:id/decide', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status: 'approved' | 'denied'; optionId?: string };
    return manager.resolvePermission(id, body);
  });

  app.get('/api/events', async (req) => {
    const { afterSeq } = req.query as { afterSeq?: string };
    return eventsAfter(Number(afterSeq ?? 0));
  });

  app.get('/api/events/recent', async (req) => {
    const { limit } = req.query as { limit?: string };
    return recentEvents(Math.min(2000, Math.max(1, Number(limit ?? 800) || 800)));
  });

  app.get('/api/projects/:id/documents', async (req) => {
    const { id } = req.params as { id: string };
    return listProjectDocuments(id);
  });

  app.post('/api/projects/:id/documents/:docType/generate', async (req) => {
    const { id, docType } = req.params as { id: string; docType: DocumentType };
    const meta = DOCUMENT_META[docType];
    if (!meta) throw new Error(`未知文档类型：${docType}`);
    if (docType === 'overview') return generateOverviewDocument(id);
    if (docType === 'code-graph') {
      const generated = generateCodeGraphDocument(id);
      if (!generated) throw new Error('尚无代码索引，请先入驻或刷新索引');
      return generated;
    }
    if (docType === 'requirements') {
      generateRequirementDocuments(id);
      return listProjectDocuments(id);
    }
    const project = getProject(id);
    ensureDocument(id, docType, docType, `${documentTypeLabel(docType)}：${project.name}`);
    void generateAgentDocument(id, docType).catch((err) => {
      console.error('[documents] generate by type failed', err);
    });
    return { status: 'started' };
  });

  app.get('/api/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const document = getDocument(id);
    return {
      document,
      sections: listDocumentSections(document.id),
      versions: documentVersions(document.id),
      sync: getDocumentSync(document.id),
      job: getDocumentJob(document.projectId, document.docType, document.slug),
    };
  });

  app.post('/api/documents/:id/regenerate', async (req) => {
    const { id } = req.params as { id: string };
    const doc = getDocument(id);
    const job = getDocumentJob(doc.projectId, doc.docType, doc.slug);
    if (job?.status === 'running') throw new Error('文档正在生成中，请稍候');
    if (doc.docType === 'overview') return generateOverviewDocument(doc.projectId);
    if (doc.docType === 'code-graph') {
      const generated = generateCodeGraphDocument(doc.projectId);
      if (!generated) throw new Error('尚无代码索引，请先刷新索引');
      return generated;
    }
    if (doc.docType === 'requirements') {
      if (doc.slug === 'legacy-baseline') {
        void generateLegacyRequirementsBaseline(doc.projectId).catch((err) => {
          console.error('[documents] legacy baseline regenerate failed', err);
        });
        return { status: 'started' };
      }
      generateRequirementDocuments(doc.projectId);
      return getDocument(doc.id);
    }
    void generateAgentDocument(doc.projectId, doc.docType).catch((err) => {
      console.error('[documents] regenerate failed', err);
    });
    return { status: 'started' };
  });

  app.post('/api/documents/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    const doc = getDocument(id);
    return cancelDocumentGeneration(doc.projectId, doc.docType, doc.slug);
  });

  app.put('/api/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { content?: string; title?: string };
    if (!body.content?.trim()) throw new Error('请提供文档内容');
    return editDocument(id, body.content, body.title, 'human');
  });

  app.post('/api/documents/:id/publish', async (req) => {
    const { id } = req.params as { id: string };
    return publishDocument(id);
  });

  app.put('/api/documents/:id/pinned', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { pinned?: boolean };
    return setDocumentPinned(id, Boolean(body.pinned));
  });

  app.get('/api/documents/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    return documentVersions(id);
  });

  app.post('/api/documents/:id/rollback', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { version?: number };
    if (!body.version) throw new Error('请提供要回滚的版本号');
    return rollbackDocument(id, Number(body.version));
  });

  app.get('/api/projects/:id/documents/sync', async (req) => {
    const { id } = req.params as { id: string };
    const { dir } = req.query as { dir?: string };
    return previewDocumentSync(id, dir);
  });

  app.post('/api/projects/:id/documents/sync', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { dir?: string; force?: boolean };
    return applyDocumentSync(id, { targetDir: body.dir, force: Boolean(body.force) });
  });

  app.post('/api/projects/:id/documents/refresh', async (req) => {
    const { id } = req.params as { id: string };
    return refreshProjectDocuments(id, true);
  });

  app.get('/api/projects/:id/documents/metrics', async (req) => {
    const { id } = req.params as { id: string };
    return documentMetrics(id);
  });

  app.get('/api/projects/:id/documents/consistency', async (req) => {
    const { id } = req.params as { id: string };
    return documentConsistency(id);
  });

  app.get('/api/projects/:id/documents/impact', async (req) => {
    const { id } = req.params as { id: string };
    const { requirementId } = req.query as { requirementId?: string };
    if (!requirementId) throw new Error('请提供 requirementId');
    return documentImpact(id, requirementId);
  });
}