import type { FastifyInstance } from 'fastify';
import type { ApprovalStatus, DodCommand } from '@acp-scrum/shared';
import {
  createProject,
  createStory,
  dodItemsForStory,
  eventsAfter,
  getProfileRecord,
  getProject,
  getStory,
  getTeamRun,
  listApprovals,
  listProjects,
  listStories,
  sessionsForStory,
  updateProjectSettings,
} from './db';
import { manager } from './acp/manager';
import { acceptStory, approveStory, reworkStory, resumeStory, startStory, storyDiff } from './service';
import { onboardProject } from './onboard';
import { indexProject, searchCode } from './indexer';
import { getIndexEntries } from './db';
import { computeMetrics } from './metrics';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => listProjects());

  app.post('/api/projects', async (req) => {
    const body = req.body as { name: string; repoPath: string; defaultBranch?: string; dodCommands?: DodCommand[]; agentKind?: string; teamMode?: boolean };
    return createProject(body);
  });

  app.post('/api/projects/:id/settings', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { agentKind?: string; teamMode?: boolean };
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

  app.get('/api/projects/:id/index', async (req) => {
    const { id } = req.params as { id: string };
    const entries = getIndexEntries(id);
    return { files: entries.length, symbols: entries.reduce((n, e) => n + e.symbols.length, 0) };
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

  app.get('/api/stories', async (req) => {
    const { projectId } = req.query as { projectId?: string };
    return listStories(projectId).map((s) => ({ ...s, dod: dodItemsForStory(s.id) }));
  });

  app.post('/api/stories', async (req) => {
    const body = req.body as { projectId: string; title: string; description?: string; acceptanceCriteria?: string };
    return createStory(body);
  });

  app.get('/api/stories/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { story: getStory(id), dod: dodItemsForStory(id), sessions: sessionsForStory(id) };
  });

  app.get('/api/stories/:id/dod', async (req) => {
    const { id } = req.params as { id: string };
    return dodItemsForStory(id);
  });

  app.get('/api/stories/:id/team', async (req) => {
    const { id } = req.params as { id: string };
    return { run: getTeamRun(id), sessions: sessionsForStory(id) };
  });

  app.get('/api/stories/:id/diff', async (req) => {
    const { id } = req.params as { id: string };
    return { diff: await storyDiff(id) };
  });

  app.post('/api/stories/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    return approveStory(id);
  });

  app.post('/api/stories/:id/start', async (req) => {
    const { id } = req.params as { id: string };
    return startStory(id);
  });

  app.post('/api/stories/:id/rework', async (req) => {
    const { id } = req.params as { id: string };
    return reworkStory(id);
  });

  app.post('/api/stories/:id/resume', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { message?: string };
    return resumeStory(id, body.message ?? '请继续完成该故事，确保满足验收标准与 DoD。');
  });

  app.post('/api/stories/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    return acceptStory(id);
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
}