import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { GitRepoState } from '@riccon-scrum/shared';

const exec = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

export async function assertRepo(repoPath: string): Promise<void> {
  const out = await git(repoPath, 'rev-parse', '--is-inside-work-tree');
  if (out !== 'true') throw new Error(`not a git repository: ${repoPath}`);
}

export async function currentBranch(repoPath: string): Promise<string> {
  return git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const out = await git(repoPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').catch(() => '');
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function repoState(repoPath: string): Promise<GitRepoState> {
  const empty: GitRepoState = {
    isRepo: false,
    hasCommits: false,
    branch: null,
    branches: [],
    detached: false,
    dirty: false,
    root: null,
    error: null,
  };
  if (!repoPath || !fsSync.existsSync(repoPath)) return { ...empty, error: '目录不存在' };
  const inside = await git(repoPath, 'rev-parse', '--is-inside-work-tree').catch(() => '');
  if (inside !== 'true') return empty;
  const root = await git(repoPath, 'rev-parse', '--show-toplevel').catch(() => null);
  const hasCommits = Boolean(await git(repoPath, 'rev-parse', '--verify', 'HEAD').catch(() => ''));
  const branch = hasCommits ? await git(repoPath, 'branch', '--show-current').catch(() => '') : '';
  const branches = await listBranches(repoPath);
  const dirty = (await git(repoPath, 'status', '--porcelain').catch(() => '')).length > 0;
  return {
    isRepo: true,
    hasCommits,
    branch: branch || null,
    branches,
    detached: hasCommits && !branch,
    dirty,
    root,
    error: null,
  };
}

export async function initRepo(repoPath: string): Promise<void> {
  fsSync.mkdirSync(repoPath, { recursive: true });
  const state = await repoState(repoPath);
  if (!state.isRepo) {
    await git(repoPath, 'init', '-b', 'main').catch(() => git(repoPath, 'init'));
  }
  const head = await git(repoPath, 'rev-parse', '--verify', 'HEAD').catch(() => '');
  if (head) return;
  await git(repoPath, 'add', '-A');
  await git(
    repoPath,
    '-c',
    'user.name=riccon-scrum',
    '-c',
    'user.email=riccon@local',
    'commit',
    '--allow-empty',
    '-m',
    'chore: initialize repository',
  );
}

export async function switchBranch(repoPath: string, branch: string): Promise<void> {
  if (!branch || branch.startsWith('-') || /[\0\n\r]/.test(branch)) throw new Error(`无效的分支名：${branch}`);
  const branches = await listBranches(repoPath);
  if (!branches.includes(branch)) throw new Error(`分支不存在：${branch}`);
  const dirty = (await git(repoPath, 'status', '--porcelain').catch(() => '')).length > 0;
  if (dirty) throw new Error('工作区存在未提交的更改，请先提交或还原后再切换分支');
  try {
    await git(repoPath, 'switch', branch);
  } catch {
    await git(repoPath, 'checkout', branch);
  }
}

export async function createWorktree(
  repoPath: string,
  branch: string,
  worktreePath: string,
  baseBranch: string,
): Promise<void> {
  await git(repoPath, 'worktree', 'add', '-b', branch, worktreePath, baseBranch);
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await git(repoPath, 'worktree', 'remove', '--force', worktreePath);
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  await git(repoPath, 'worktree', 'prune');
}

export async function createDetachedWorktree(repoPath: string, worktreePath: string, baseBranch: string): Promise<void> {
  await git(repoPath, 'worktree', 'add', '--detach', worktreePath, baseBranch);
}

export async function docChanges(cwd: string): Promise<string[]> {
  const tracked = await git(cwd, 'diff', '--name-only', 'HEAD').catch(() => '');
  const untracked = await git(cwd, 'ls-files', '--others', '--exclude-standard').catch(() => '');
  const all = [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);
  return all.filter((f) => f.toLowerCase().endsWith('.md') || f.startsWith('docs/'));
}

export async function hasChanges(cwd: string): Promise<boolean> {
  return (await git(cwd, 'status', '--porcelain')).length > 0;
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, 'add', '-A');
  await git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

export async function diffAgainst(cwd: string, baseBranch: string): Promise<string> {
  return git(cwd, 'diff', `${baseBranch}...HEAD`);
}

export async function workingDiff(cwd: string): Promise<string> {
  const tracked = await git(cwd, 'diff', 'HEAD');
  const untracked = await git(cwd, 'ls-files', '--others', '--exclude-standard');
  const parts = [tracked];
  for (const file of untracked.split('\n').filter(Boolean)) {
    const content = await fs.readFile(path.join(cwd, file), 'utf8').catch(() => '');
    const body = content.split('\n').map((l) => '+' + l).join('\n');
    parts.push(`diff --git a/${file} b/${file}\nnew file: ${file}\n${body}`);
  }
  return parts.filter(Boolean).join('\n');
}

export async function mergeBranch(repoPath: string, branch: string, message: string): Promise<string> {
  await git(repoPath, 'merge', '--no-ff', branch, '-m', message);
  return git(repoPath, 'rev-parse', 'HEAD');
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'story'
  );
}