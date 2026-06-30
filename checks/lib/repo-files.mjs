// repo-files — list a repo's files by extension for the source-scanning
// invariants (dispatch-dups, bats-assertions). Prefers `git ls-files` (fast,
// respects .gitignore); falls back to a bounded FS walk skipping the usual
// non-source trees, so the checks still run in a non-git scratch tree.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'node_modules.nosync', 'dist',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
]);

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

// Repo-relative paths whose extension is in `extensions` (with or without dot).
export function listFiles(root, extensions) {
  const exts = new Set(extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)));
  const files = gitFiles(root) ?? walk(root);
  return files.filter((f) => exts.has(path.extname(f)));
}
