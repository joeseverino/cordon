// git.ts — the engine's git plumbing in one place, so no invariant re-derives
// "is this a git repo" or "what files does it have". A gate engine must have a
// single answer to both. Consumed by repository-policy, idempotence, and the
// source-scanning invariants (dispatch-dups, bats-assertions).
//
// (capabilities.ts keeps its own dependency-free `.git`-exists probe for the
// `git` capability — that layer deliberately avoids spawning git.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Variables git exports to hooks (`git rev-parse --local-env-vars`). Inherited,
// they point every git call at the hook's repo instead of --root, so a gate run
// from pre-push scans the wrong tree. The engine drops them once at startup.
const REPO_LOCAL_GIT_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];

export function dropRepoLocalGitEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of REPO_LOCAL_GIT_ENV) delete env[name];
}

// Every git call here answers for `root`, whoever the caller is.
function git(root: string, args: string[]) {
  const env = { ...process.env };
  dropRepoLocalGitEnv(env);
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
]);

export function isGitRepo(root: string): boolean {
  const r = git(root, ['rev-parse', '--is-inside-work-tree']);
  return r.status === 0 && r.stdout.trim() === 'true';
}

// The porcelain worktree state, for idempotence's before/after diff.
export const worktreeStatus = (root: string): string =>
  git(root, ['status', '--porcelain']).stdout;

function gitFiles(root: string): string[] | null {
  const r = git(root, ['ls-files', '-z']);
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter(Boolean);
}

function walk(root: string): string[] {
  const out: string[] = [];
  const stack = ['.'];
  while (stack.length) {
    const rel = stack.pop();
    if (rel === undefined) break;
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
export function repoFiles(root: string): string[] {
  return gitFiles(root) ?? walk(root);
}

// repoFiles filtered to the given extensions (with or without leading dot).
export function listFiles(root: string, extensions: string[]): string[] {
  const exts = new Set(extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)));
  return repoFiles(root).filter((f) => exts.has(path.extname(f)));
}
