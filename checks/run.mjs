#!/usr/bin/env node
// cordon checks runner — the repo-level analog of `--describe`. Where --describe
// lets an agent risk-gate one *command* by its blast radius, this runs every
// applicable check over a whole *repo* and emits a machine-readable verdict an
// agent can act on: is it shippable, and what fixes each failure.
//
//   node checks/run.mjs                 # run all applicable checks over the cwd
//   node checks/run.mjs --root <dir>    # run over another repo
//   node checks/run.mjs --phase <p>     # only pre-build | build | post-build
//   node checks/run.mjs --only <id>     # run a single check (the rerun command)
//   node checks/run.mjs --json          # the agent/CI contract (only stdout)
//   node checks/run.mjs --report        # always write the report (else: on failure)
//   node checks/run.mjs --list          # list the checks that apply to the repo
//   node checks/run.mjs --schema        # emit the cordon.checks.json JSON Schema
//
// The run report (.cordon-checks-report.md — a whole-picture status table, then
// each failure's fix + rerun + folded output) is written on failure, so a green
// run leaves no file behind locally. `--report` writes it even when green (the
// always-there record), and a CI run (the `CI` env) turns that on automatically,
// so the summary is always there in CI but never clutters a local green run.
//
// The engine merges two kinds of check. **Invariants** are cordon's built-in,
// in-process, portable rules (registry.mjs). **Commands** are a repo's own
// spawned specs (playwright, tsc, a bespoke audit), declared as data in
// cordon.checks.json `commands[]` — spec definitions stay home; the engine is
// central. Each check declares the capabilities it `requires` (capabilities.mjs)
// and a `phase`; the engine detects what's available and skips fail-soft what
// isn't (playwright not installed, no build output, wrong platform), so the
// default posture is lean and a repo lights up only what it opts into. Collect-
// all, never short-circuit: one pass surfaces every problem.
//
// Per-repo config is an optional cordon.checks.json at the repo root: per-check
// keys (`{ "<id>": { ...config } }`), plus `builtDirs` and `commands[]`. Point
// its `$schema` at `--schema`'s output for editor autocomplete + AI. Zero runtime
// dependencies: the checks are the contract, this is just the loop.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checksFor } from './registry.mjs';
import { buildConfigSchema } from './config-schema.mjs';
import { detect, DEFAULT_BUILT_DIRS } from './lib/capabilities.mjs';
import { runProcess, DEFAULT_TIMEOUT_MS } from './lib/run-process.mjs';

const SCHEMA_VERSION = 2;
const PHASES = ['pre-build', 'build', 'post-build'];
const DEFAULT_PHASE = 'pre-build';

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// The check's own blast radius (cordon's effect ladder) + off-box / TTY tags —
// the cost of producing this row, in the same vocabulary a command's --describe
// uses.
const effectChip = (r) => C.dim(`[${[r.effect, r.network && '+network', r.interactive && '+interactive'].filter(Boolean).join(' ')}]`);

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (has('-h') || has('--help')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
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
const only = valueOf('--only', null);
const phaseFilter = valueOf('--phase', null);
// Write the report even on a green run when explicitly asked (--report) or in CI
// (so the always-there summary shows there, without cluttering a local green run).
const forceReport = has('--report') || Boolean(process.env.CI);
const reportPath = path.join(root, '.cordon-checks-report.md');
const selfPath = fileURLToPath(import.meta.url);

const say = jsonMode ? () => {} : (s) => console.log(s);

if (phaseFilter && !PHASES.includes(phaseFilter)) {
  console.error(`cordon: unknown phase '${phaseFilter}' (expected ${PHASES.join(' | ')})`);
  process.exit(2);
}

// — Per-repo config: per-check keys + builtDirs + commands[] —
let config = {};
const configPath = path.join(root, 'cordon.checks.json');
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`cordon: ignoring unreadable cordon.checks.json (${e.message})`);
  }
}
const builtDirs = Array.isArray(config.builtDirs) ? config.builtDirs : DEFAULT_BUILT_DIRS;

// — Normalize both kinds into one entry shape the loop runs uniformly —
const invariantEntries = checksFor('check').map((c) => ({
  kind: 'invariant',
  id: c.id, name: c.name, effect: c.effect,
  network: c.network, interactive: c.interactive,
  requires: c.requires ?? [], phase: c.phase ?? DEFAULT_PHASE,
  fix: c.fix, run: c.run,
}));

// A command entry is consumer data; validate the two fields the engine can't
// infer (a spawn target, and the blast radius an agent risk-gates on) and fail
// closed — an unclassified spec must never run as if it were a safe read.
function loadCommandEntries() {
  return (Array.isArray(config.commands) ? config.commands : []).map((cmd, i) => {
    const where = `cordon.checks.json commands[${i}]`;
    if (!cmd || typeof cmd !== 'object') throw new Error(`${where} must be an object`);
    if (!cmd.id) throw new Error(`${where} is missing 'id'`);
    if (!cmd.effect) throw new Error(`${where} ('${cmd.id}') must declare an 'effect' (its blast radius)`);
    if (!cmd.exec || typeof cmd.exec.cmd !== 'string') throw new Error(`${where} ('${cmd.id}') must declare exec.cmd`);
    return {
      kind: 'command',
      id: cmd.id, name: cmd.name ?? cmd.id, effect: cmd.effect,
      network: cmd.network, interactive: cmd.interactive,
      requires: cmd.requires ?? [], phase: cmd.phase ?? DEFAULT_PHASE,
      fix: cmd.fix ?? 'See the command output in the report for the failure.',
      exec: { cmd: cmd.exec.cmd, args: cmd.exec.args ?? [], env: cmd.exec.env },
      timeout: cmd.timeout ?? DEFAULT_TIMEOUT_MS,
    };
  });
}

let entries;
try {
  entries = [...invariantEntries, ...loadCommandEntries()];
} catch (e) {
  console.error(`cordon: ${e.message}`);
  process.exit(2);
}
const entryById = (id) => entries.find((e) => e.id === id);

// Built-in and consumer ids share one namespace (a verdict row is keyed by id);
// a collision would make `--only` / `failed[]` ambiguous.
const dupes = entries.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dupes.length) {
  console.error(`cordon: duplicate check id(s): ${[...new Set(dupes)].join(', ')}`);
  process.exit(2);
}

if (has('--list')) {
  const span = Math.max(4, ...entries.map((e) => e.id.length));
  for (const e of entries) {
    const reqs = e.requires.length ? C.dim(` requires ${e.requires.join(',')}`) : '';
    console.log(`  ${e.id.padEnd(span)}  ${C.dim(`[${e.kind} · ${e.phase}]`)} ${e.name}${reqs}`);
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
function rerunFor(entry) {
  if (entry.kind === 'command') {
    const env = Object.entries(entry.exec.env ?? {}).map(([k, v]) => `${k}=${v}`).join(' ');
    return `${env} ${entry.exec.cmd} ${entry.exec.args.join(' ')}`.trim();
  }
  // Relative to where the user runs it (cwd), not the target root — so the line
  // is copy-pasteable as-is, with --root naming the repo when it isn't the cwd.
  const base = `node ${path.relative(process.cwd(), selfPath) || 'checks/run.mjs'}`;
  const rootArg = root === process.cwd() ? '' : ` --root ${root}`;
  return `${base} --only ${entry.id}${rootArg}`;
}

// Keep the report reviewable when a command (playwright especially) dumps
// thousands of lines: keep the head and tail, point at the rerun command.
function clipOutput(text, head = 20, tail = 60) {
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
  const base = `node ${path.relative(process.cwd(), selfPath) || 'checks/run.mjs'}`;
  return root === process.cwd() ? base : `${base} --root ${root}`;
}

const GLYPH = { pass: '✅', fail: '❌', skip: '⏭️' };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
const clip = (s, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const noteFor = (r) =>
  r.status === 'fail' ? r.fix
    : r.status === 'skip' ? (r.unmet ? `requires ${r.unmet.join(', ')}` : r.detail || 'skipped')
      : '';

// The always-written run report — the human record CI surfaces and you open
// locally, green or red. A whole-picture status table (every check, not just
// failures, so a skip is never mistaken for a pass), then each failure's fix +
// rerun + folded output, then a provenance footer. Markdown so GitHub renders it
// inline in the run summary. Derived entirely from `results` — the JSON verdict
// is the other render of the same source.
function renderReport(results, failed) {
  const n = (s) => results.filter((r) => r.status === s).length;
  let md = `# Cordon checks — ${failed.length ? `${failed.length} failed` : 'all passed'}\n\n`;
  md += `${n('pass')} passed · ${n('fail')} failed · ${n('skip')} skipped\n\n`;

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

async function runOne(entry, caps) {
  const base = {
    id: entry.id, name: entry.name, status: 'pass', durationMs: 0,
    effect: entry.effect, network: entry.network, interactive: entry.interactive,
    phase: entry.phase, detail: '', fix: entry.fix,
  };
  const unmet = caps.unmet(entry.requires);
  if (unmet.length) {
    return { ...base, status: 'skip', unmet, detail: `requires ${unmet.join(', ')} — not available here` };
  }
  const start = Date.now();
  if (entry.kind === 'invariant') {
    let r;
    try {
      r = entry.run({ root, config: config[entry.id] ?? {}, builtDirs });
    } catch (e) {
      r = { ok: false, detail: `check threw: ${e.message}` };
    }
    const status = r.skipped ? 'skip' : r.ok ? 'pass' : 'fail';
    return { ...base, status, durationMs: Date.now() - start, detail: r.detail ?? '' };
  }
  const r = await runProcess(entry.exec.cmd, entry.exec.args, { cwd: root, env: entry.exec.env, timeout: entry.timeout });
  return { ...base, status: r.code === 0 ? 'pass' : 'fail', durationMs: r.duration, detail: r.output.trim() };
}

const TAG = { pass: C.green('[PASS]'), fail: C.red('[FAIL]'), skip: C.yellow('[SKIP]') };
function printResult(r) {
  say(`  ${TAG[r.status]} ${r.name} ${effectChip(r)} (${r.durationMs}ms)`);
  if (r.detail && r.status !== 'pass') say(r.detail.split('\n').map((l) => `         ${l}`).join('\n'));
}

// Run a phase's checks concurrency-capped, but print each in entry order as soon
// as it and everything before it has settled (graduated from diagnose's
// runAuditsOrdered) — clean, deterministic output even when commands run async.
async function runPhase(phaseEntries, caps, limit = 4) {
  const results = new Array(phaseEntries.length);
  let next = 0;
  let printedThrough = 0;
  const flush = () => {
    while (printedThrough < phaseEntries.length && results[printedThrough] !== undefined) {
      printResult(results[printedThrough]);
      printedThrough += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, phaseEntries.length) }, async () => {
    while (next < phaseEntries.length) {
      const i = next++;
      results[i] = await runOne(phaseEntries[i], caps);
      flush();
    }
  }));
  return results;
}

async function main() {
  say(C.bold(`cordon checks · ${root}\n`));
  const results = [];
  for (const phase of activePhases) {
    // Re-detect each phase: the `build` phase produces output, so a later
    // `built-dir` check must see the freshly-emitted tree, not the pre-build state.
    const caps = detect(root, { builtDirs });
    const phaseEntries = selected.filter((e) => e.phase === phase);
    if (multiPhase) say(C.dim(`▸ ${phase}`));
    results.push(...await runPhase(phaseEntries, caps));
    if (multiPhase) say('');
  }

  const failed = results.filter((r) => r.status === 'fail');
  const reportRel = path.relative(root, reportPath);

  // Write the report on failure (the file you open, CI surfaces) — and on a green
  // run only when forced (--report / CI), the always-there record. Otherwise a
  // green local run leaves no file behind. gitignored; never committed.
  const wroteReport = failed.length > 0 || forceReport;
  if (wroteReport) {
    fs.writeFileSync(reportPath, renderReport(results, failed), 'utf8');
  } else if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      ok: failed.length === 0,
      schema_version: SCHEMA_VERSION,
      failed: failed.map((r) => r.id),
      report: failed.length ? reportRel : null,
      checks: results.map((r) => ({
        id: r.id, name: r.name, status: r.status, durationMs: r.durationMs, effect: r.effect,
        ...(multiPhase ? { phase: r.phase } : {}),
        ...(r.network ? { network: true } : {}),
        ...(r.interactive ? { interactive: true } : {}),
        ...(r.unmet ? { unmet: r.unmet } : {}),
        ...(r.status === 'fail' ? { fix: r.fix, rerun: rerunFor(entryById(r.id)) } : {}),
      })),
    }, null, 2));
  } else if (failed.length === 0) {
    say(C.bold(C.green('✓ all checks passed')) + (wroteReport ? C.dim(` — ${reportRel}`) : ''));
  } else {
    say(C.bold(C.red(`✗ ${failed.length} check(s) failed`)) + ` — see ${reportRel}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main();
