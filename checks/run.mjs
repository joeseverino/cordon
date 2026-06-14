#!/usr/bin/env node
// cordon checks runner — the repo-level analog of `--describe`. Where --describe
// lets an agent risk-gate one *command* by its blast radius, this runs every
// portable invariant over a whole *repo* and emits a machine-readable verdict an
// agent can act on: is it shippable, and what is the fix for each failure.
//
//   node checks/run.mjs                 # run all checks over the cwd (human)
//   node checks/run.mjs --root <dir>    # run over another repo
//   node checks/run.mjs --only <id>     # run a single check (the rerun command)
//   node checks/run.mjs --json          # the agent/CI contract (only stdout)
//   node checks/run.mjs --list          # list available checks and exit
//   node checks/run.mjs --schema        # emit the cordon.checks.json JSON Schema
//
// Collect-all, never short-circuit: one pass surfaces every problem. Per-repo
// configuration is an optional `cordon.checks.json` at the repo root,
// `{ "<check-id>": { ...config } }`, handed to each check as ctx.config — absent
// keys fall back to the check's own defaults, so zero config still runs. Point
// that file's `$schema` at `--schema`'s output for editor autocomplete + AI.
// Zero runtime dependencies: the checks are the contract, this is just the loop.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CHECKS, checkById, checksFor } from './registry.mjs';
import { buildConfigSchema } from './config-schema.mjs';

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// The check's own blast radius (cordon's effect ladder), plus the off-box /
// TTY tags — the cost of producing the verdict, in the same vocabulary an agent
// already reads off a command's --describe.
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
if (has('--list')) {
  for (const c of CHECKS) console.log(`  ${c.id.padEnd(22)} ${c.name}`);
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
const reportPath = path.join(root, '.cordon-checks-report.md');

const say = jsonMode ? () => {} : (s) => console.log(s);

// Optional per-repo config: { "<check-id>": { ... } }.
let config = {};
const configPath = path.join(root, 'cordon.checks.json');
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error(`cordon: ignoring unreadable cordon.checks.json (${e.message})`);
  }
}

const selected = only ? [checkById(only)].filter(Boolean) : checksFor('check');
if (only && selected.length === 0) {
  console.error(`cordon: no such check '${only}' (try --list)`);
  process.exit(2);
}

// The exact command to reproduce one check outside the gate.
const rerunFor = (id) => {
  const base = `node ${path.relative(root, fileURLToPath(import.meta.url)) || 'checks/run.mjs'}`;
  const rootArg = root === process.cwd() ? '' : ` --root ${root}`;
  return `${base} --only ${id}${rootArg}`;
};

function runOne(check) {
  const start = Date.now();
  let result;
  try {
    result = check.run({ root, config: config[check.id] ?? {} });
  } catch (e) {
    result = { ok: false, detail: `check threw: ${e.message}` };
  }
  const status = result.skipped ? 'skip' : result.ok ? 'pass' : 'fail';
  return {
    id: check.id, name: check.name, status, durationMs: Date.now() - start,
    detail: result.detail ?? '', fix: check.fix,
    effect: check.effect, network: check.network, interactive: check.interactive,
  };
}

const results = selected.map(runOne);
const failed = results.filter((r) => r.status === 'fail');

if (jsonMode) {
  console.log(JSON.stringify({
    ok: failed.length === 0,
    schema_version: 1,
    failed: failed.map((r) => r.id),
    report: failed.length ? path.relative(root, reportPath) : null,
    checks: results.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      durationMs: r.durationMs,
      effect: r.effect,
      ...(r.network ? { network: true } : {}),
      ...(r.interactive ? { interactive: true } : {}),
      ...(r.status === 'fail' ? { fix: r.fix, rerun: rerunFor(r.id) } : {}),
    })),
  }, null, 2));
} else {
  say(C.bold(`cordon checks · ${root}\n`));
  for (const r of results) {
    const tag = r.status === 'skip' ? C.yellow('[SKIP]') : r.status === 'pass' ? C.green('[PASS]') : C.red('[FAIL]');
    say(`  ${tag} ${r.name} ${effectChip(r)} (${r.durationMs}ms)`);
    if (r.detail && r.status !== 'pass') say(r.detail.split('\n').map((l) => `         ${l}`).join('\n'));
  }
  say('');
  if (failed.length === 0) {
    say(C.bold(C.green(`✓ all checks passed`)));
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  } else {
    let md = `# Cordon checks report\n\n${failed.length} check(s) failed.\n\n`;
    for (const r of failed) {
      md += `## ${r.name} (\`${r.id}\`)\n\n**Fix:** ${r.fix}\n\n**Rerun:** \`${rerunFor(r.id)}\`\n\n`;
      if (r.detail) md += `\`\`\`\n${r.detail}\n\`\`\`\n\n`;
    }
    fs.writeFileSync(reportPath, md, 'utf8');
    say(C.bold(C.red(`✗ ${failed.length} check(s) failed`)) + ` — see ${path.relative(root, reportPath)}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
