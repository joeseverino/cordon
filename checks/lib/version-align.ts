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
import { parseArgs } from 'node:util';
import { errorMessage } from '../../lib/guards.ts';

const root = process.cwd();

// `[project].version`: scan only the [project] table, line-based so an unrelated
// `version =` in another table (e.g. [tool.x]) can't be mistaken for it.
function projectVersion(text: string): string | null {
  let inProject = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inProject = line === '[project]'; continue; }
    if (inProject) {
      const m = line.match(/^version\s*=\s*["']([^"']+)["']/);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

// The module __version__: a src-layout `src/<pkg>/__init__.py`, else `<pkg>/__init__.py`.
function moduleVersion(): { file: string; version: string } | null {
  for (const base of ['src', '.']) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, base), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules') continue;
      const init = path.join(root, base, e.name, '__init__.py');
      let text;
      try { text = fs.readFileSync(init, 'utf8'); } catch { continue; }
      const m = text.match(/^__version__\s*=\s*["']([^"']+)["']/m);
      if (m?.[1]) return { file: path.relative(root, init), version: m[1] };
    }
  }
  return null;
}

function run(fix: boolean): number {
  let toml;
  try {
    toml = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
  } catch {
    return 0;
  }
  const declared = projectVersion(toml);
  if (!declared) return 0;
  const mod = moduleVersion();
  if (!mod) return 0;

  if (declared === mod.version) {
    console.log(`version aligned: ${declared} (pyproject == ${mod.file})`);
    return 0;
  }
  // pyproject is canonical (the release bumper's target), so the repair
  // direction is deterministic.
  if (fix) {
    const initPath = path.join(root, mod.file);
    const text = fs.readFileSync(initPath, 'utf8');
    fs.writeFileSync(initPath, text.replace(
      /^(__version__\s*=\s*)["'][^"']+["']/m, `$1"${declared}"`,
    ));
    console.log(`rewrote ${mod.file} __version__ ${mod.version} -> ${declared} (pyproject is canonical)`);
    return 0;
  }
  console.error(`version mismatch: pyproject [project].version=${declared} but ${mod.file} __version__=${mod.version}`);
  return 1;
}

let fix: boolean;
try {
  fix = Boolean(parseArgs({ options: { fix: { type: 'boolean' } }, strict: true, allowPositionals: false }).values.fix);
} catch (e) {
  console.error(`version-align: ${errorMessage(e)}`);
  process.exit(2);
}
process.exitCode = run(fix);
