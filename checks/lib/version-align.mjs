#!/usr/bin/env node
// version-align — assert a Python package's pyproject `[project].version` matches
// its module `__version__`. The generic form of a per-repo version_check, so the
// rule lives in cordon's catalog (referenced) instead of a hand-written command
// in every repo. Runs from the repo root; finds `__version__` in a src-layout (or
// flat) `<pkg>/__init__.py`. No-ops (exit 0) when there's nothing to align — a
// dynamic/absent version, or no module __version__ — so it's safe in any
// pyproject repo and only *fails* on a genuine mismatch.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

let toml;
try {
  toml = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
} catch {
  process.exit(0); // no pyproject — nothing to do
}

// `[project].version` — scan only the [project] table, line-based so an unrelated
// `version =` in another table (e.g. [tool.x]) can't be mistaken for it.
function projectVersion(text) {
  let inProject = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inProject = line === '[project]'; continue; }
    if (inProject) {
      const m = line.match(/^version\s*=\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
  }
  return null;
}

const declared = projectVersion(toml);
if (!declared) process.exit(0); // dynamic or unspecified version — nothing to align

// The module __version__: a src-layout `src/<pkg>/__init__.py`, else `<pkg>/__init__.py`.
function moduleVersion() {
  for (const base of ['src', '.']) {
    let entries;
    try { entries = fs.readdirSync(path.join(root, base), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules') continue;
      const init = path.join(root, base, e.name, '__init__.py');
      let text;
      try { text = fs.readFileSync(init, 'utf8'); } catch { continue; }
      const m = text.match(/^__version__\s*=\s*["']([^"']+)["']/m);
      if (m) return { file: path.relative(root, init), version: m[1] };
    }
  }
  return null;
}

const mod = moduleVersion();
if (!mod) process.exit(0); // no module __version__ to compare against

if (declared !== mod.version) {
  console.error(`version mismatch: pyproject [project].version=${declared} but ${mod.file} __version__=${mod.version}`);
  process.exit(1);
}
console.log(`version aligned: ${declared} (pyproject == ${mod.file})`);
