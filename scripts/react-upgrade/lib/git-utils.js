// Git command utilities for executing git operations

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function git(args, cwd, options = {}) {
  const { allowFailure = false } = options;

  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || '',
        exitCode: error.code || 1,
      };
    }
    throw error;
  }
}

export async function getBranches(cwd) {
  const { stdout } = await git(['branch', '--list', '--format=%(refname:short)'], cwd);
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

export async function getTags(cwd) {
  const { stdout } = await git(['tag', '--list'], cwd);
  return stdout ? stdout.split('\n').filter(Boolean) : [];
}

export async function getCommitsBetween(baseRef, headRef, cwd) {
  const { stdout } = await git(
    ['log', `${baseRef}..${headRef}`, '--format=%H|%s', '--reverse'],
    cwd
  );

  if (!stdout) return [];

  return stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, ...subjectParts] = line.split('|');
    return { hash, subject: subjectParts.join('|') };
  });
}

export async function cherryPick(commitHash, cwd) {
  const result = await git(['cherry-pick', commitHash], cwd, { allowFailure: true });

  if (result.exitCode === 0) {
    return { success: true, conflicted: false };
  }

  // Check if it's a conflict
  const statusResult = await git(['status', '--porcelain'], cwd);
  const hasConflict = statusResult.stdout.split('\n').some((line) => line.startsWith('U'));

  return { success: false, conflicted: hasConflict };
}

export async function amendCommitMessage(newMessage, cwd) {
  await git(['commit', '--amend', '-m', newMessage], cwd);
}

export async function getCurrentBranch(cwd) {
  const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return stdout;
}

export async function checkoutBranch(branchName, cwd, options = {}) {
  const { create = false, startPoint = null } = options;
  let args;
  if (create && startPoint) {
    args = ['checkout', '-b', branchName, startPoint];
  } else if (create) {
    args = ['checkout', '-b', branchName];
  } else {
    args = ['checkout', branchName];
  }
  await git(args, cwd);
}

export async function branchExists(branchName, cwd) {
  const result = await git(
    ['rev-parse', '--verify', branchName],
    cwd,
    { allowFailure: true }
  );
  return result.exitCode === 0;
}

export async function deleteBranch(branchName, cwd, options = {}) {
  const { force = false } = options;
  const args = force ? ['branch', '-D', branchName] : ['branch', '-d', branchName];
  await git(args, cwd);
}

export async function stageFiles(paths, cwd) {
  await git(['add', ...paths], cwd);
}

export async function commit(message, cwd) {
  await git(['commit', '-m', message], cwd);
}

export const gitUtils = {
  git,
  getBranches,
  getTags,
  getCommitsBetween,
  cherryPick,
  amendCommitMessage,
  getCurrentBranch,
  checkoutBranch,
  branchExists,
  deleteBranch,
  stageFiles,
  commit,
};
