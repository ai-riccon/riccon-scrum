import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

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