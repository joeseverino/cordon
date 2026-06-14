// repository-policy — a repo-agnostic hygiene invariant: no secrets, build
// output, conflict copies, ambiguous module siblings, or unpinned GitHub Actions
// in the tree. Graduated from jseverino.com's check-repository-policy.mjs; the
// universal rules run with zero config, the stack-specific ones (Node pin,
// lockfile parity, extra scan dirs) are config-gated and fail soft when the
// thing they check isn't present — so this same check runs unmodified in any
// repo (see checks/README.md).
//
// A cordon check is a module exporting { id, name, fix, gates, run(ctx) }.
//   ctx    = { root, config }   — root is the repo, config is this check's slice
//   run -> { ok, detail }  |  { skipped:true, detail }   (never throws for a
//          policy violation; throws only on a genuinely broken environment)
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  // Directories whose tracked contents are always build output / never source.
  forbiddenDirs: ['dist', 'playwright-report', 'test-results'],
  // Extra trees to walk for *untracked* iCloud conflict copies ("name 2.ext").
  // Tracked conflict copies are caught regardless; default [] = walk nothing.
  conflictScanDirs: [],
  // Stack-specific gates — auto-skip when the file they need is absent.
  checkNvmrc: true,
  checkLockfile: true,
  // Supply-chain: by default accept tag/branch action pins (e.g. @v5). Set
  // false to enforce full commit-SHA pins (the hardened house policy) — do
  // that once the churn settles.
  allowTaggedActions: true,
};

const CONFLICT_COPY = / [0-9]+(?:\.[^/]*)?$/; // "report 2", "logo 3.png" (iCloud)

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(' ')} exited ${r.status}`);
  return r.stdout.trim();
}

function isGitRepo(root) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

const readJson = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const exists = (root, file) => fs.existsSync(path.join(root, file));

export default {
  id: 'repository-policy',
  name: 'Repository Policy',
  effect: 'read',
  gates: ['check'],
  fix: 'Untrack secrets/build output, remove iCloud conflict copies, pin GitHub '
    + 'Actions to a commit SHA, align the lockfile, or match .nvmrc. The detail '
    + 'lists each offending path.',

  run({ root, config = {} }) {
    if (!isGitRepo(root)) return { skipped: true, detail: 'not a git work tree — nothing to police' };
    const cfg = { ...DEFAULTS, ...config };
    const failures = [];
    const fail = (m) => failures.push(m);

    const tracked = git(root, ['ls-files']).split('\n').filter(Boolean);

    // — Universal: secrets, build output, and tracked conflict copies —
    const dirRe = new RegExp(`(^|/)(?:${cfg.forbiddenDirs.join('|')})(/|$)`);
    const forbidden = tracked.filter((f) =>
      (/(^|\/)\.env(?:\.|$)/.test(f) && !f.endsWith('.env.example'))
      || (/(^|\/)\.dev\.vars(?:\.|$)/.test(f) && !f.endsWith('.dev.vars.example'))
      || dirRe.test(f)
      || CONFLICT_COPY.test(path.basename(f)));
    if (forbidden.length) fail(`forbidden tracked files (secret/build/conflict): ${forbidden.join(', ')}`);

    // — Universal: same-basename JS/TS siblings resolve ambiguously —
    const stems = new Map();
    for (const f of tracked) {
      const m = f.match(/^(.*)\.(mjs|cjs|js|jsx|mts|cts|ts|tsx)$/);
      if (!m) continue;
      if (!stems.has(m[1])) stems.set(m[1], new Set());
      stems.get(m[1]).add(m[2]);
    }
    const collisions = [];
    for (const [stem, exts] of stems) {
      const js = ['mjs', 'cjs', 'js', 'jsx'].some((e) => exts.has(e));
      const ts = ['mts', 'cts', 'ts', 'tsx'].some((e) => exts.has(e));
      if (js && ts) collisions.push(`${stem}.{${[...exts].sort().join(',')}}`);
    }
    if (collisions.length) fail(`ambiguous JS/TS module siblings (bundler picks .mjs, tsc picks .ts): ${collisions.sort().join(', ')}`);

    // — Supply-chain: every GitHub Action pinned to a full SHA (unless opted out) —
    if (!cfg.allowTaggedActions) {
      for (const f of tracked.filter((n) => n.startsWith('.github/workflows/'))) {
        const src = fs.readFileSync(path.join(root, f), 'utf8');
        for (const m of src.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
          const ref = m[1];
          if (ref.startsWith('./')) continue;
          if (/^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(ref)) continue;
          if (/^[^@\s]+@[0-9a-f]{40}$/.test(ref)) continue;
          fail(`${f}: unpinned action ${ref} (pin to a commit SHA, or set allowTaggedActions)`);
        }
      }
    }

    // — Config-gated: untracked conflict copies in declared trees —
    const conflicts = [];
    for (const base of cfg.conflictScanDirs) {
      const abs = path.join(root, base);
      if (!fs.existsSync(abs)) continue;
      const pending = [abs];
      while (pending.length) {
        const cur = pending.pop();
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          const p = path.join(cur, e.name);
          if (CONFLICT_COPY.test(e.name)) conflicts.push(path.relative(root, p));
          if (e.isDirectory()) pending.push(p);
        }
      }
    }
    if (conflicts.length) fail(`untracked iCloud conflict copies: ${conflicts.sort().join(', ')}`);

    // — Config-gated, fail-soft: Node pin —
    if (cfg.checkNvmrc && exists(root, '.nvmrc')) {
      const want = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
      const got = process.versions.node;
      const mm = (v) => v.split('.').slice(0, 2).join('.');
      if (mm(got) !== mm(want)) fail(`Node ${got} != .nvmrc ${want} (major.minor must agree)`);
    }

    // — Config-gated, fail-soft: lockfile parity —
    if (cfg.checkLockfile && exists(root, 'package.json') && exists(root, 'package-lock.json')) {
      const pkg = readJson(root, 'package.json');
      const lock = readJson(root, 'package-lock.json');
      if (lock.name !== pkg.name) fail('package-lock.json name differs from package.json');
      if (lock.version !== pkg.version) fail('package-lock.json version differs from package.json');
      const rootPkg = lock.packages?.[''] ?? {};
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        if (!isDeepStrictEqual(rootPkg[field] ?? {}, pkg[field] ?? {})) {
          fail(`package-lock.json root ${field} differ from package.json`);
        }
      }
    }

    return failures.length
      ? { ok: false, detail: failures.map((m) => `- ${m}`).join('\n') }
      : { ok: true, detail: `${tracked.length} tracked files clean: no secrets/build output, modules unambiguous, actions pinned` };
  },
};
