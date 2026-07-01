// git.mjs — the engine's git plumbing in one place, so no invariant re-derives
// "is this a git repo" or "what files does it have". A gate engine must have a
// single answer to both. Consumed by repository-policy, idempotence, and the
// source-scanning invariants (dispatch-dups, bats-assertions).
//
// (capabilities.mjs keeps its own dependency-free `.git`-exists probe for the
// `git` capability — that layer deliberately avoids spawning git.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'node_modules.nosync', 'dist',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
]);

export function isGitRepo(root) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

// The porcelain worktree state, for idempotence's before/after diff.
export const worktreeStatus = (root) =>
  spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;

function gitFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter(Boolean);
}

function walk(root) {
  const out = [];
  const stack = ['.'];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childRel = rel === '.' ? e.name : path.join(rel, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

// Every repo file as a repo-relative path. Prefers `git ls-files` (tracked, fast,
// respects .gitignore); falls back to a bounded FS walk so the source-scanning
// invariants still run in a non-git scratch tree.
export function repoFiles(root) {
  return gitFiles(root) ?? walk(root);
}

// repoFiles filtered to the given extensions (with or without leading dot).
export function listFiles(root, extensions) {
  const exts = new Set(extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)));
  return repoFiles(root).filter((f) => exts.has(path.extname(f)));
}
