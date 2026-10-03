#!/usr/bin/env node
// cordon checks runner — the repo-level analog of `--describe`. Where --describe
// lets an agent risk-gate one *command* by its blast radius, this runs every
// applicable check over a whole *repo* and emits a machine-readable verdict an
// agent can act on: is it shippable, and what fixes each failure.
//
//   node checks/run.ts                 # run all applicable checks over the cwd
//   node checks/run.ts --root <dir>    # run over another repo
//   node checks/run.ts --phase <p>     # only pre-build | build | post-build
//   node checks/run.ts --only <id>     # run a single check (the rerun command)
//   node checks/run.ts --json          # the agent/CI contract (only stdout)
//   node checks/run.ts --fix           # run declared repairs on failures, re-run to prove them
//   node checks/run.ts --report        # always write the report (else: on failure)
//   node checks/run.ts --list          # list the checks that apply to the repo
//   node checks/run.ts --schema        # emit the cordon.checks.json JSON Schema
//
// --fix is the autofix seam: a failing check whose definition declares a repair
// (an invariant's `repair(ctx)`, or a command's `fixExec` — including a
// `fix:<name>` script paired with a discovered `check:<name>`) gets the repair
// run, then the SAME check re-run; only a green re-run reports `fixed` (proven,
// never trusted). Repairs mutate the worktree, so they run only under --fix —
// a plain run never writes. Checks without a repair fail exactly as before.
//
// The run report (.cordon-checks-report.md — a whole-picture status table, then
// each failure's fix + rerun + folded output) is written on failure, so a green
// run leaves no file behind locally. `--report` writes it even when green (the
// always-there record), and a CI run (the `CI` env) turns that on automatically,
// so the summary is always there in CI but never clutters a local green run.
//
// The engine merges two kinds of check. **Invariants** are cordon's built-in,
// in-process, portable rules (registry.ts). **Commands** are cordon's per-stack
// catalog (catalog.ts) plus a repo's own spawned specs (tsc, a bespoke audit),
// declared as data in cordon.checks.json `commands[]` — spec definitions stay
// home; the engine is central. Each check declares the capabilities it
// `requires` (capabilities.ts) and a `phase`; the engine detects what's
// available and skips fail-soft what isn't (a tool not installed, wrong
// platform), so the default posture is lean and a repo lights up only what it
// opts into. Phases (pre-build → build → post-build) order a repo's own
// commands around its build step; every built-in check is pre-build. Collect-
// all, never short-circuit: one pass surfaces every problem.
//
// Per-repo config is an optional cordon.checks.json at the repo root: per-check
// keys (`{ "<id>": { ...config } }`), plus `enable`/`disable` and `commands[]`. Point
// its `$schema` at `--schema`'s output for editor autocomplete + AI. Zero runtime
// dependencies: the checks are the contract, this is just the loop.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { checksFor } from './registry.ts';
import { buildConfigSchema } from './config-schema.ts';
import { detect } from './lib/capabilities.ts';
import { dropRepoLocalGitEnv } from './lib/git.ts';
import { runProcess, DEFAULT_TIMEOUT_MS } from './lib/run-process.ts';
import { CATALOG } from './catalog.ts';
import { discoverScripts } from './lib/discover-scripts.ts';
import type { Check, CheckConfig, CheckContext } from './lib/types.ts';
import type { CommandSpec } from './catalog.ts';

dropRepoLocalGitEnv();

// The normalized entry the loop runs, and the result row it reports.
export type Status = 'pass' | 'fail' | 'skip' | 'fixed';
export interface ExecLine { cmd: string; args: string[]; env: Record<string, string> | undefined }
interface EntryBase {
  source: string;
  id: string;
  name: string;
  effect: string;
  network?: boolean | undefined;
  interactive?: boolean | undefined;
  requires: string[];
  phase: string;
  default?: string | undefined;
  fix: string;
}
export interface InvariantEntry extends EntryBase {
  kind: 'invariant';
  run: Check['run'];
  repair: Check['repair'] | undefined;
}
export interface CommandEntry extends EntryBase {
  kind: 'command';
  exec: ExecLine;
  fixExec: ExecLine | undefined;
  timeout: number;
  expand: CommandSpec['expand'] | undefined;
}
export type Entry = InvariantEntry | CommandEntry;
type RepairableEntry =
  | (InvariantEntry & { repair: NonNullable<Check['repair']> })
  | (CommandEntry & { fixExec: ExecLine });
export interface ResultRow {
  id: string;
  name: string;
  status: Status;
  durationMs: number;
  effect: string;
  network?: boolean | undefined;
  interactive?: boolean | undefined;
  phase: string;
  detail: string;
  fix: string;
  unmet?: string[];
  repair?: string;
}
// The --json verdict (the agent/CI contract).
export interface VerdictRow {
  id: string;
  name: string;
  status: Status;
  durationMs: number;
  effect: string;
  phase?: string;
  network?: true;
  interactive?: true;
  unmet?: string[];
  repair?: string;
  fix?: string;
  rerun?: string;
  detail?: string;
}
export interface Verdict {
  ok: boolean;
  schema_version: number;
  failed: string[];
  fixed: string[];
  report: string | null;
  checks: VerdictRow[];
}
// cordon.checks.json: engine keys plus a per-check slice keyed by id.
interface RepoConfig {
  enable?: unknown;
  disable?: unknown;
  commands?: unknown;
  [id: string]: unknown;
}
interface Caps { unmet(requires: string[]): string[] }

const SCHEMA_VERSION = 3;
const PHASES = ['pre-build', 'build', 'post-build'];
const DEFAULT_PHASE = 'pre-build';

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// The check's own blast radius (cordon's effect ladder) + off-box / TTY tags —
// the cost of producing this row, in the same vocabulary a command's --describe
// uses.
const effectChip = (r: ResultRow) => C.dim(`[${[r.effect, r.network && '+network', r.interactive && '+interactive'].filter(Boolean).join(' ')}]`);

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = <T,>(flag: string, fallback: T): string | T => {
  const i = args.indexOf(flag);
  const v = args[i + 1];
  return i >= 0 && v ? v : fallback;
};

if (has('-h') || has('--help')) {
  console.log(fs.readFileSync(import.meta.filename, 'utf8')
    .split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
if (has('--schema')) {
  // Byte-deterministic so the committed checks/config.schema.json can be diffed
  // and kept fresh by the dogfooded idempotence check (cordon.checks.json).
  console.log(JSON.stringify(buildConfigSchema(), null, 2));
  process.exit(0);
}

const root = path.resolve(valueOf('--root', process.cwd()));
const jsonMode = has('--json');
const fixMode = has('--fix');
const only = valueOf('--only', null);
const phaseFilter = valueOf('--phase', null);
// Write the report even on a green run when explicitly asked (--report) or in CI
// (so the always-there summary shows there, without cluttering a local green run).
const forceReport = has('--report') || Boolean(process.env.CI);
const reportPath = path.join(root, '.cordon-checks-report.md');
const selfPath = import.meta.filename;

// A thrown value's message, as the original `${e.message}` read it.
function errorMessage(e: unknown): unknown {
  return typeof e === 'object' && e !== null && 'message' in e ? e.message : undefined;
}

const say = jsonMode ? (_s: string) => {} : (s: string) => console.log(s);

if (phaseFilter && !PHASES.includes(phaseFilter)) {
  console.error(`cordon: unknown phase '${phaseFilter}' (expected ${PHASES.join(' | ')})`);
  process.exit(2);
}

// — Per-repo config: per-check keys + enable/disable + commands[] —
let config: RepoConfig = {};
const configPath = path.join(root, 'cordon.checks.json');
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`cordon: ignoring unreadable cordon.checks.json (${errorMessage(e)})`);
  }
}
// A check's own slice of cordon.checks.json (parsed JSON, so narrowed here).
const sliceFor = (id: string) => (config[id] ?? {}) as CheckConfig;
const ctxFor = (id: string): CheckContext => ({ root, config: sliceFor(id) });

// — Normalize every check into one entry shape the loop runs uniformly. Four
// layers, in precedence order: cordon's in-process invariants, its built-in
// command catalog (per-stack, auto-detected), the repo's own discovered task
// scripts, and the repo's explicit commands[] escape hatch. A later layer
// reusing an id intentionally overrides an earlier one (a repo replacing a
// catalog default); `enable`/`disable` then decide what's active. —
const invariantEntries = checksFor('check').map((c): InvariantEntry => ({
  kind: 'invariant', source: 'invariant',
  id: c.id, name: c.name, effect: c.effect,
  requires: c.requires ?? [], phase: c.phase ?? DEFAULT_PHASE,
  fix: c.fix, run: c.run,
  // The autofix seam: an invariant MAY export repair(ctx) — mechanical
  // remediation the engine runs (only under --fix), then re-verifies.
  repair: typeof c.repair === 'function' ? c.repair : undefined,
}));

// Shape a command spec (catalog, discovered, or repo) into a runnable entry.
// `validate` fails closed on repo data — an unclassified spec must never run as
// if it were a safe read; catalog/discovered specs are cordon's own, trusted.
function toCommandEntry(cmd: CommandSpec, source: string, where: string, validate = false): CommandEntry {
  if (validate) {
    if (!cmd || typeof cmd !== 'object') throw new Error(`${where} must be an object`);
    if (!cmd.id) throw new Error(`${where} is missing 'id'`);
    if (!cmd.effect) throw new Error(`${where} ('${cmd.id}') must declare an 'effect' (its blast radius)`);
    if (!cmd.exec || typeof cmd.exec.cmd !== 'string') throw new Error(`${where} ('${cmd.id}') must declare exec.cmd`);
    if (cmd.fixExec && typeof cmd.fixExec.cmd !== 'string') throw new Error(`${where} ('${cmd.id}') fixExec must declare fixExec.cmd`);
  }
  return {
    kind: 'command', source,
    id: cmd.id, name: cmd.name ?? cmd.id, effect: cmd.effect,
    network: cmd.network, interactive: cmd.interactive,
    requires: cmd.requires ?? [], phase: cmd.phase ?? DEFAULT_PHASE,
    default: cmd.default, fix: cmd.fix ?? 'See the command output in the report for the failure.',
    exec: { cmd: cmd.exec.cmd, args: cmd.exec.args ?? [], env: cmd.exec.env },
    // The autofix seam for commands: a spec that knows how to repair what it
    // flags (ruff --fix, a paired fix:<name> script). Runs only under --fix.
    fixExec: cmd.fixExec ? { cmd: cmd.fixExec.cmd, args: cmd.fixExec.args ?? [], env: cmd.fixExec.env } : undefined,
    timeout: cmd.timeout ?? DEFAULT_TIMEOUT_MS,
    // A catalog entry may vary its run over a dimension (e.g. pytest across Python
    // versions); only cordon's own catalog declares this, never repo JSON.
    expand: typeof cmd.expand === 'function' ? cmd.expand : undefined,
  };
}

// Config-level on/off — names only, the bare-minimum knob a repo ever needs.
// `disable` is a hard "never"; `default:'off'` checks (heavy/opt-in) stay off
// until named in `enable` or targeted directly by `--only`. Capability
// `requires` are evaluated later, per phase.
const enable = new Set<string>(Array.isArray(config.enable) ? config.enable : []);
const disable = new Set<string>(Array.isArray(config.disable) ? config.disable : []);
const isActive = (e: Entry) =>
  !disable.has(e.id) && (e.default !== 'off' || enable.has(e.id) || only === e.id);

let layers: Entry[][];
try {
  layers = [
    invariantEntries,
    CATALOG.map((c) => toCommandEntry(c, 'catalog', `catalog '${c.id}'`)),
    discoverScripts(root).map((c) => toCommandEntry(c, 'discovered', `discovered '${c.id}'`)),
    (Array.isArray(config.commands) ? config.commands : [])
      .map((c: CommandSpec, i: number) => toCommandEntry(c, 'repo', `cordon.checks.json commands[${i}]`, true)),
  ];
} catch (e) {
  console.error(`cordon: ${errorMessage(e)}`);
  process.exit(2);
}

// A duplicate id WITHIN a layer is an authoring mistake (ambiguous --only /
// verdict key); a later layer reusing an earlier id is an intentional override,
// honored by letting later layers win into the id-keyed map.
for (const layer of layers) {
  const dup = layer.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) {
    console.error(`cordon: duplicate check id(s): ${[...new Set(dup)].join(', ')}`);
    process.exit(2);
  }
}
const byId = new Map<string, Entry>();
for (const layer of layers) for (const e of layer) byId.set(e.id, e);
const entries = [...byId.values()].filter(isActive);
const entryById = (id: string): Entry => {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`cordon: no check '${id}'`);
  return entry;
};

if (has('--list')) {
  // The "what runs here, and why" view: resolve capabilities against this repo
  // so each active check shows run vs skip(reason) — the auto-detect made visible.
  const caps = detect(root);
  const span = Math.max(4, ...entries.map((e) => e.id.length));
  for (const e of entries) {
    const unmet = caps.unmet(e.requires);
    const mark = unmet.length ? C.yellow('skip') : C.green('run ');
    const why = unmet.length ? C.dim(` — needs ${unmet.join(', ')}`) : '';
    // Make a matrix visible: if it'll run, show the variants it expands to.
    let matrix = '';
    if (!unmet.length && e.kind === 'command' && e.expand) {
      const variants = e.expand({ root, config: sliceFor(e.id) });
      if (variants && variants.length) matrix = C.dim(` ×[${variants.map((v) => v.label).join(',')}]`);
    }
    console.log(`  ${mark} ${e.id.padEnd(span)} ${C.dim(`[${e.source} · ${e.effect}]`)} ${e.name}${matrix}${why}`);
  }
  process.exit(0);
}

const selected = only ? entries.filter((e) => e.id === only) : entries;
if (only && selected.length === 0) {
  console.error(`cordon: no such check '${only}' (try --list)`);
  process.exit(2);
}
const activePhases = PHASES.filter((p) =>
  (!phaseFilter || p === phaseFilter) && selected.some((e) => e.phase === p));
// Emit `phase` only when the run spans more than one — minimal in the common
// single-phase case, complete (and deterministic per config) when phases matter.
const multiPhase = activePhases.length > 1;

// The exact command to reproduce one check standalone — an invariant via this
// runner, a command via its own exec line (env prefix + cmd + args).
function rerunFor(entry: Entry) {
  if (entry.kind === 'command') {
    const env = Object.entries(entry.exec.env ?? {}).map(([k, v]) => `${k}=${v}`).join(' ');
    return `${env} ${entry.exec.cmd} ${entry.exec.args.join(' ')}`.trim();
  }
  // Relative to where the user runs it (cwd), not the target root — so the line
  // is copy-pasteable as-is, with --root naming the repo when it isn't the cwd.
  const base = `node ${path.relative(process.cwd(), selfPath) || 'checks/run.ts'}`;
  const rootArg = root === process.cwd() ? '' : ` --root ${root}`;
  return `${base} --only ${entry.id}${rootArg}`;
}

// Keep the report reviewable when a command (a big test suite especially) dumps
// thousands of lines: keep the head and tail, point at the rerun command.
function clipOutput(text: string, head = 20, tail = 60) {
  const lines = text.trim().split('\n');
  if (lines.length <= head + tail + 1) return text.trim();
  return [
    ...lines.slice(0, head),
    `… ${lines.length - head - tail} lines elided — use the rerun command above for full output …`,
    ...lines.slice(-tail),
  ].join('\n');
}

// The whole-gate rerun (no --only) — copy-pasteable from the user's cwd.
function gateCmd() {
  const base = `node ${path.relative(process.cwd(), selfPath) || 'checks/run.ts'}`;
  return root === process.cwd() ? base : `${base} --root ${root}`;
}

const GLYPH = { pass: '✅', fail: '❌', skip: '⏭️', fixed: '🔧' };
const cell = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const noteFor = (r: ResultRow) =>
  r.status === 'fail' ? r.fix
    : r.status === 'skip' ? (r.unmet ? `requires ${r.unmet.join(', ')}` : r.detail || 'skipped')
      : r.status === 'fixed' ? `repaired: ${r.repair} — review and commit the change`
        : '';

// The always-written run report — the human record CI surfaces and you open
// locally, green or red. A whole-picture status table (every check, not just
// failures, so a skip is never mistaken for a pass), then each failure's fix +
// rerun + folded output, then a provenance footer. Markdown so GitHub renders it
// inline in the run summary. Derived entirely from `results` — the JSON verdict
// is the other render of the same source.
function renderReport(results: ResultRow[], failed: ResultRow[]) {
  const n = (s: Status) => results.filter((r) => r.status === s).length;
  let md = `# Cordon checks — ${failed.length ? `${failed.length} failed` : 'all passed'}\n\n`;
  md += `${n('pass')} passed · ${n('fail')} failed · ${n('skip')} skipped${n('fixed') ? ` · ${n('fixed')} repaired (review + commit)` : ''}\n\n`;

  md += '| | check | effect | note |\n|:--:|---|---|---|\n';
  for (const r of results) {
    md += `| ${GLYPH[r.status]} | ${cell(r.name)} | \`${r.effect}\` | ${cell(clip(noteFor(r)))} |\n`;
  }
  md += '\n';

  for (const r of failed) {
    md += `## ❌ ${r.name} (\`${r.id}\`)\n\n**Fix:** ${r.fix}\n\n**Rerun:** \`${rerunFor(entryById(r.id))}\`\n\n`;
    if (r.detail) md += `<details><summary>output</summary>\n\n\`\`\`\n${clipOutput(r.detail)}\n\`\`\`\n\n</details>\n\n`;
  }

  md += '---\n';
  md += `<sub>Generated by [cordon checks](https://github.com/joeseverino/cordon) · `
    + `\`schema_version ${SCHEMA_VERSION}\` · rerun all: \`${gateCmd()}\` · `
    + `by [@joeseverino](https://github.com/joeseverino)</sub>\n`;
  return md;
}

async function runOne(entry: Entry, caps: Caps): Promise<ResultRow> {
  const base: ResultRow = {
    id: entry.id, name: entry.name, status: 'pass', durationMs: 0,
    effect: entry.effect, network: entry.network, interactive: entry.interactive,
    phase: entry.phase, detail: '', fix: entry.fix,
  };
  const unmet = caps.unmet(entry.requires);
  if (unmet.length) {
    return { ...base, status: 'skip', unmet, detail: `requires ${unmet.join(', ')} — not available here` };
  }
  // A command whose binary can't be spawned at all (ENOENT) is a setup gap, not
  // dirty code — skip fail-soft (like an unmet `requires`) so a missing tool can
  // never false-RED the gate. The fix is to declare the tool in `requires` (so
  // it skips before spawn) or install it; the note says which.
  const spawnSkip = (r: { duration: number }, cmd: string): ResultRow => ({
    ...base, status: 'skip', durationMs: r.duration, unmet: [cmd],
    detail: `command not found: ${cmd} — add it to this check's \`requires\`, or install it`,
  });
  const start = Date.now();
  if (entry.kind === 'invariant') {
    let r;
    try {
      r = entry.run(ctxFor(entry.id));
    } catch (e) {
      r = { ok: false, detail: `check threw: ${errorMessage(e)}` };
    }
    const status = r.skipped ? 'skip' : r.ok ? 'pass' : 'fail';
    return { ...base, status, durationMs: Date.now() - start, detail: r.detail ?? '' };
  }
  // A matrix check (pytest over Python versions): run each variant, pass only if
  // all do, and fold the per-variant output into one result row — so a CI gate
  // still sees a single check, and the report names which variant failed.
  const variants = entry.expand ? entry.expand({ root, config: sliceFor(entry.id) }) : null;
  if (variants && variants.length) {
    let failed = false;
    let durationMs = 0;
    const parts = [];
    for (const v of variants) {
      const r = await runProcess(entry.exec.cmd, v.args, { cwd: root, env: entry.exec.env, timeout: entry.timeout });
      if (r.spawnFailed) return spawnSkip({ duration: durationMs + r.duration }, entry.exec.cmd);
      durationMs += r.duration;
      if (r.code !== 0) failed = true;
      parts.push(`── ${entry.name} [${v.label}] — ${r.code === 0 ? 'ok' : 'FAILED'} ──\n${r.output.trim()}`);
    }
    return {
      ...base,
      name: `${entry.name} (${variants.map((v) => v.label).join(', ')})`,
      status: failed ? 'fail' : 'pass',
      durationMs,
      detail: parts.join('\n\n'),
    };
  }
  const r = await runProcess(entry.exec.cmd, entry.exec.args, { cwd: root, env: entry.exec.env, timeout: entry.timeout });
  if (r.spawnFailed) return spawnSkip(r, entry.exec.cmd);
  return { ...base, status: r.code === 0 ? 'pass' : 'fail', durationMs: r.duration, detail: r.output.trim() };
}

// A repairer is declared on the definition (invariant repair(ctx) / command
// fixExec) — describe it for the audit trail before running it.
const hasRepair = (entry: Entry): entry is RepairableEntry =>
  (entry.kind === 'invariant' ? Boolean(entry.repair) : Boolean(entry.fixExec));
const repairDesc = (entry: RepairableEntry) => (entry.kind === 'invariant'
  ? `repair(ctx) of invariant '${entry.id}'`
  : `${entry.fixExec.cmd} ${entry.fixExec.args.join(' ')}`.trim());

// The --fix beat: a failed check with a declared repair gets the repair run,
// then the SAME check re-run through runOne. Only a green re-run reports
// `fixed` — the mutation is proven by the verifier, never trusted. A repair
// that errors or doesn't heal leaves the original failure, annotated.
async function attemptRepair(entry: Entry, result: ResultRow, caps: Caps): Promise<ResultRow> {
  if (result.status !== 'fail') return result;
  if (!hasRepair(entry)) return result;
  const desc = repairDesc(entry);
  let repairNote = '';
  const start = Date.now();
  try {
    if (entry.kind === 'invariant') {
      const r = entry.repair(ctxFor(entry.id));
      if (r && r.ok === false) throw new Error(r.detail || 'repair reported failure');
      repairNote = (r && r.detail) || '';
    } else {
      const r = await runProcess(entry.fixExec.cmd, entry.fixExec.args, { cwd: root, env: entry.fixExec.env, timeout: entry.timeout });
      if (r.spawnFailed || r.code !== 0) throw new Error(r.output.trim() || `exited ${r.code}`);
      repairNote = r.output.trim();
    }
  } catch (e) {
    return {
      ...result,
      durationMs: result.durationMs + (Date.now() - start),
      detail: `${result.detail}\n— repair attempted (${desc}) but failed: ${errorMessage(e)}`.trim(),
    };
  }
  const rerun = await runOne(entry, caps);
  const durationMs = result.durationMs + (Date.now() - start);
  if (rerun.status === 'pass') {
    return { ...rerun, status: 'fixed', durationMs, repair: desc, detail: repairNote };
  }
  return {
    ...rerun,
    durationMs,
    detail: `${rerun.detail}\n— repair ran (${desc}) but the re-run still fails`.trim(),
  };
}

const TAG = { pass: C.green('[PASS]'), fail: C.red('[FAIL]'), skip: C.yellow('[SKIP]'), fixed: C.green('[FIXED]') };
function printResult(r: ResultRow) {
  say(`  ${TAG[r.status]} ${r.name} ${effectChip(r)} (${r.durationMs}ms)`);
  if (r.status === 'fixed') say(C.dim(`         ↳ repaired: ${r.repair}`));
  if (r.detail && r.status !== 'pass' && r.status !== 'fixed') say(r.detail.split('\n').map((l) => `         ${l}`).join('\n'));
}

// Run a phase's checks concurrency-capped, but print each in entry order as soon
// as it and everything before it has settled (graduated from diagnose's
// runAuditsOrdered) — clean, deterministic output even when commands run async.
async function runPhase(phaseEntries: Entry[], caps: Caps, limit = 4) {
  const results = new Array<ResultRow>(phaseEntries.length);
  let next = 0;
  let printedThrough = 0;
  const flush = () => {
    while (printedThrough < phaseEntries.length) {
      const r = results[printedThrough];
      if (r === undefined) break;
      printResult(r);
      printedThrough += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, phaseEntries.length) }, async () => {
    while (next < phaseEntries.length) {
      const i = next++;
      const entry = phaseEntries[i];
      if (entry === undefined) break;
      let r = await runOne(entry, caps);
      if (fixMode) r = await attemptRepair(entry, r, caps);
      results[i] = r;
      flush();
    }
  }));
  return results;
}

async function main() {
  say(C.bold(`cordon checks · ${root}\n`));
  const results: ResultRow[] = [];
  const caps = detect(root);
  for (const phase of activePhases) {
    const phaseEntries = selected.filter((e) => e.phase === phase);
    if (multiPhase) say(C.dim(`▸ ${phase}`));
    results.push(...await runPhase(phaseEntries, caps));
    if (multiPhase) say('');
  }

  const failed = results.filter((r) => r.status === 'fail');
  const fixed = results.filter((r) => r.status === 'fixed');
  const reportRel = path.relative(root, reportPath);

  // Write the report on failure (the file you open, CI surfaces) — and on a green
  // run only when forced (--report / CI), the always-there record. Otherwise a
  // green local run leaves no file behind. gitignored; never committed.
  const wroteReport = failed.length > 0 || forceReport;
  if (wroteReport) {
    const md = renderReport(results, failed);
    fs.writeFileSync(reportPath, md, 'utf8');
    // Publish the report straight to the CI run summary when present — the engine
    // owns surfacing its own result, so a green OR red gate always shows its
    // table, even if the calling workflow never cats the file. This closes the
    // recurring "the gate failed but there's no cordon summary" gap: a non-zero
    // exit must never swallow the report.
    const stepSummary = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummary) {
      try { fs.appendFileSync(stepSummary, `${md}\n`); } catch { /* best-effort: never let publishing the report fail the run */ }
    }
  } else if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }

  if (jsonMode) {
    const verdict: Verdict = {
      ok: failed.length === 0,
      schema_version: SCHEMA_VERSION,
      failed: failed.map((r) => r.id),
      fixed: fixed.map((r) => r.id),
      report: failed.length ? reportRel : null,
      checks: results.map((r) => ({
        id: r.id, name: r.name, status: r.status, durationMs: r.durationMs, effect: r.effect,
        ...(multiPhase ? { phase: r.phase } : {}),
        ...(r.network ? { network: true } : {}),
        ...(r.interactive ? { interactive: true } : {}),
        ...(r.unmet ? { unmet: r.unmet } : {}),
        ...(r.status === 'fixed' ? { repair: r.repair } : {}),
        ...(r.status === 'fail' ? { fix: r.fix, rerun: rerunFor(entryById(r.id)), detail: clipOutput(r.detail) } : {}),
      })),
    };
    console.log(JSON.stringify(verdict, null, 2));
  } else if (failed.length === 0) {
    const repaired = fixed.length ? C.yellow(` — ${fixed.length} repaired, review + commit the changes`) : '';
    say(C.bold(C.green('✓ all checks passed')) + repaired + (wroteReport ? C.dim(` — ${reportRel}`) : ''));
  } else {
    say(C.bold(C.red(`✗ ${failed.length} check(s) failed`)) + ` — see ${reportRel}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main();
