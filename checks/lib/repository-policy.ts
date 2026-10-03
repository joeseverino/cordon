// repository-policy — a repo-agnostic hygiene invariant: no secrets, build
// output, conflict copies, ambiguous module siblings, or unpinned GitHub Actions
// in the tree. Graduated from jseverino.com's repository-policy check; the
// universal rules run with zero config, the stack-specific ones (Node pin,
// lockfile parity, extra scan dirs) are config-gated and fail soft when the
// thing they check isn't present — so this same check runs unmodified in any
// repo (see checks/README.md).
//
// A cordon check is a module exporting { id, name, fix, gates, run(ctx) }.
//   ctx    = { root, config }   — root is the repo, config is this check's slice
//   run -> { ok, detail }  |  { skipped:true, detail }   (never throws for a
//          policy violation; throws only on a genuinely broken environment)
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { defaultsOf } from './config.ts';
import { isGitRepo, repoFiles } from './git.ts';
import type { Check, ConfigSchema } from './types.ts';

interface RepositoryPolicyConfig {
  forbiddenDirs: string[];
  conflictScanDirs: string[];
  checkNvmrc: boolean;
  checkLockfile: boolean;
  allowTaggedActions: boolean;
}

// The package.json / package-lock.json fields lockfile parity compares.
interface PackageJson {
  name?: unknown;
  version?: unknown;
  packages?: Record<string, Record<string, unknown>>;
  [field: string]: unknown;
}

// The check's config seam, declared once as JSON Schema and carried on the
// default export — see idempotence.ts for the pattern. config-schema.ts
// composes it into the published `cordon.checks.json` schema; the runtime
// DEFAULTS below derive from it, so the documented and actual default are one.
const configSchema: ConfigSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Repo hygiene: no tracked secrets/build output/conflict copies, unambiguous modules, pinned Actions. Universal rules need no config; the keys below tune the stack-specific ones.',
  properties: {
    forbiddenDirs: {
      type: 'array',
      items: { type: 'string' },
      default: ['dist', 'playwright-report', 'test-results'],
      description: 'Directories whose tracked contents are always build output, never source.',
    },
    conflictScanDirs: {
      type: 'array',
      items: { type: 'string' },
      default: [],
      description: 'Extra trees to walk for untracked conflict copies ("name 2.ext", left by Finder or iCloud). Tracked copies are caught regardless; [] walks nothing.',
    },
    checkNvmrc: {
      type: 'boolean',
      default: true,
      description: 'When a .nvmrc is present, require the running Node major.minor to match it.',
    },
    checkLockfile: {
      type: 'boolean',
      default: true,
      description: 'When package.json and package-lock.json are both present, require their name/version/dependencies to agree.',
    },
    allowTaggedActions: {
      type: 'boolean',
      default: true,
      description: 'Accept tag/branch GitHub Action pins (e.g. @v5). Set false to enforce full commit-SHA pins (the hardened house policy).',
    },
  },
};

const DEFAULTS = defaultsOf<RepositoryPolicyConfig>(configSchema);

const CONFLICT_COPY = / [0-9]+(?:\.[^/]*)?$/; // "report 2", "logo 3.png" (Finder or iCloud duplicates)

const readJson = (root: string, file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as PackageJson;
const exists = (root: string, file: string) => fs.existsSync(path.join(root, file));

export default {
  id: 'repository-policy',
  name: 'Repository Policy',
  effect: 'read',
  gates: ['check'],
  configSchema,
  fix: 'Untrack secrets/build output, remove conflict copies, pin GitHub '
    + 'Actions to a commit SHA, align the lockfile, or match .nvmrc. The detail '
    + 'lists each offending path.',

  run({ root, config = {} }) {
    if (!isGitRepo(root)) return { skipped: true, detail: 'not a git work tree — nothing to police' };
    const cfg = { ...DEFAULTS, ...config };
    const failures: string[] = [];
    const fail = (m: string) => failures.push(m);

    const tracked = repoFiles(root);

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
          const ref = m[1] ?? '';
          if (ref.startsWith('./')) continue;
          if (/^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(ref)) continue;
          if (/^[^@\s]+@[0-9a-f]{40}$/.test(ref)) continue;
          fail(`${f}: unpinned action ${ref} (pin to a commit SHA, or set allowTaggedActions)`);
        }
      }
    }

    // — Config-gated: untracked conflict copies in declared trees —
    const conflicts: string[] = [];
    for (const base of cfg.conflictScanDirs) {
      const abs = path.join(root, base);
      if (!fs.existsSync(abs)) continue;
      const pending = [abs];
      while (pending.length) {
        const cur = pending.pop();
        if (cur === undefined) break;
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          const p = path.join(cur, e.name);
          if (CONFLICT_COPY.test(e.name)) conflicts.push(path.relative(root, p));
          if (e.isDirectory()) pending.push(p);
        }
      }
    }
    if (conflicts.length) fail(`untracked conflict copies: ${conflicts.sort().join(', ')}`);

    // — Config-gated, fail-soft: Node pin —
    if (cfg.checkNvmrc && exists(root, '.nvmrc')) {
      const want = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
      const got = process.versions.node;
      const mm = (v: string) => v.split('.').slice(0, 2).join('.');
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
} satisfies Check<RepositoryPolicyConfig>;
