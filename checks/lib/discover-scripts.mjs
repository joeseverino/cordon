// discover-scripts.mjs — the "declare it once, where you already keep tasks"
// seam. A repo's bespoke checks shouldn't be re-listed in cordon.checks.json when
// the repo already names them in its native task runner. For Node that's
// package.json `scripts`: every `check:*` entry (the audit convention — e.g.
// jseverino.com's check:links / check:contrast / check:seo) is synthesized into
// a catalog-shaped `read` command. So those light up with NO cordon.checks.json.
//
// Only `check:*` is harvested — an audit is a read by construction. `test:*` is
// deliberately left out: its variants (…:ui, …:visual, …:update) span TTY,
// network, and snapshot-mutation, so they can't all be classified `read` and
// belong behind an explicit `enable` or a commands[] entry with a stated effect.
// A repo drops one discovered check with `disable: ["check:links"]`.
import fs from 'node:fs';
import path from 'node:path';

export function discoverScripts(root) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return []; // no package.json, or unreadable — nothing to discover
  }
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== 'object') return [];

  return Object.keys(scripts)
    .filter((name) => name.startsWith('check:'))
    .sort()
    .map((name) => ({
      id: name,
      name: `npm run ${name}`,
      effect: 'read',
      requires: ['npm'],
      exec: { cmd: 'npm', args: ['run', '-s', name] },
      fix: `Run \`npm run ${name}\` and fix what it reports.`,
    }));
}
