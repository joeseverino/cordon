// dispatch-dups — a portable invariant catching duplicate CLI dispatch in a
// Python argparse program: two subparsers registered under the same id, or two
// dispatch arms (`if/elif args.<dest> == "x"`, or a `match`/`case "x"`) for the
// same command — the second silently dead. Born from a `__main__.py` that carried
// two `args.command == "backfill-aliases"` arms (the second unreachable) which no
// lint flagged, colliding with a refactor that removed an import.
//
// Scoped to files that actually wire up an argparse dispatch (`add_subparsers(`
// present, or a `__main__.py`), so it never fires on an unrelated `== "x"` in app
// code. Docstrings and `#` comments are stripped first, so a parser id named in a
// docstring example isn't mistaken for a real registration. Read-only, no config.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './git.mjs';

// Blank out triple-quoted blocks (preserving newlines for line numbers) and
// trailing `#` comments, so the scan sees code, not prose. Conservative by
// design: when in doubt it removes text rather than risk a false match.
function codeLines(src) {
  const noDocstrings = src.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, (m) => m.replace(/[^\n]/g, ' '));
  return noDocstrings.split('\n').map((line) => line.replace(/#.*$/, ''));
}

function isDispatchFile(relPath, src) {
  return path.basename(relPath) === '__main__.py' || /\badd_subparsers\s*\(/.test(src);
}

// Record an occurrence keyed by its dispatch identity; later we keep only keys
// seen on more than one line (a genuine duplicate, not the same line rescanned).
function record(map, key, line) {
  const lines = map.get(key) ?? [];
  if (!lines.includes(line)) lines.push(line);
  map.set(key, lines);
}

function scanFile(relPath, src) {
  const lines = codeLines(src);
  const parserIds = new Map();
  const arms = new Map();
  const cases = new Map();

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    for (const m of line.matchAll(/\badd_parser\(\s*['"]([^'"]+)['"]/g)) {
      record(parserIds, m[1], lineNo);
    }
    for (const m of line.matchAll(/\bargs\.(\w+)\s*==\s*['"]([^'"]+)['"]/g)) {
      record(arms, `args.${m[1]} == "${m[2]}"`, lineNo);
    }
    const caseMatch = line.match(/^\s*case\s+['"]([^'"]+)['"]\s*:/);
    if (caseMatch) record(cases, caseMatch[1], lineNo);
  });

  const failures = [];
  const dupes = (map, describe) => {
    for (const [key, lns] of map) {
      if (lns.length > 1) failures.push(`${relPath}: ${describe(key)} (lines ${lns.join(', ')})`);
    }
  };
  dupes(parserIds, (id) => `duplicate subparser id "${id}"`);
  dupes(arms, (arm) => `duplicate dispatch arm \`${arm}\``);
  dupes(cases, (label) => `duplicate \`case "${label}"\` arm`);
  return failures;
}

export default {
  id: 'dispatch-dups',
  name: 'CLI Dispatch Duplicates',
  effect: 'read',
  gates: ['check'],
  fix: 'Remove the duplicate dispatch arm or subparser id — the second is dead code. '
    + 'The detail lists each id/arm and the lines it appears on.',

  run({ root }) {
    const files = listFiles(root, ['.py']);
    const scanned = [];
    const failures = [];
    for (const rel of files) {
      let src;
      try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
      if (!isDispatchFile(rel, src)) continue;
      scanned.push(rel);
      failures.push(...scanFile(rel, src));
    }
    if (scanned.length === 0) return { skipped: true, detail: 'no Python argparse dispatch found' };
    return failures.length
      ? { ok: false, detail: failures.map((m) => `- ${m}`).join('\n') }
      : { ok: true, detail: `${scanned.length} dispatch file(s) clean: no duplicate arms or subparser ids` };
  },
};
