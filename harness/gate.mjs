#!/usr/bin/env node
// Cordon reference enforcement point (PEP) — opt-in, zero-dependency.
//
// Wraps a single invocation of a cordon-conformant tool: runs the tool's own
// `--describe`, resolves the invoked command's declared effect, asks the PDP
// (policy.mjs) for a verdict, then allows / confirms / blocks before running it.
//
// Opt-in by design. Nothing is injected into a shell or a tool — you call
// `cordon-gate <tool> [command] [args...]` when you want the gate. The wrapped
// tool needs no knowledge of cordon, so a consumer repo stays standalone and
// cloneable; this reads only the `--describe` output every emitter already
// produces.
//
//   CORDON_POLICY=local (default) | strict   choose the preset
//   CORDON_GATE_BYPASS=1                      allow a confirm-class command to run
//                                             non-interactively (explicit escape)

import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { PRESETS, verdict, resolveEffect } from './policy.mjs';

function describe(tool) {
  const res = spawnSync(tool, ['--describe'], { encoding: 'utf8' });
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`'${tool} --describe' did not emit a contract`);
  }
  return JSON.parse(res.stdout);
}

function confirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main(argv) {
  const [tool, ...args] = argv;
  if (!tool) {
    console.error('usage: cordon-gate <tool> [command] [args...]');
    return 2;
  }
  const presetName = process.env.CORDON_POLICY || 'local';
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(`cordon: unknown CORDON_POLICY '${presetName}' (use local | strict)`);
    return 2;
  }

  const contract = describe(tool);
  // A subcommand tool gates on the named command; a leaf tool gates on its
  // tool-level effect and forwards every arg.
  const hasCommands = (contract.commands || []).length > 0;
  const command = hasCommands ? args[0] : undefined;
  const forward = hasCommands ? args.slice(1) : args;
  const effect = resolveEffect(contract, command);
  const v = verdict(effect, preset);
  const label = `${tool}${command ? ` ${command}` : ''}`;

  if (v.decision === 'block') {
    console.error(`cordon: blocked ${label} — ${v.reason}`);
    return 1;
  }
  if (v.decision === 'confirm') {
    if (process.stdin.isTTY) {
      if (!(await confirm(`cordon: ${label} is ${v.effect} — proceed?`))) {
        console.error('cordon: declined');
        return 1;
      }
    } else if (process.env.CORDON_GATE_BYPASS === '1') {
      console.error(`cordon: ${label} (${v.effect}) — CORDON_GATE_BYPASS set, proceeding`);
    } else {
      console.error(
        `cordon: blocked ${label} — ${v.effect} needs confirmation but there is no TTY ` +
          '(set CORDON_GATE_BYPASS=1 to override)',
      );
      return 1;
    }
  }

  // allow, or a confirmed/bypassed confirm: run the real invocation through.
  const run = spawnSync(tool, command ? [command, ...forward] : forward, { stdio: 'inherit' });
  return run.status ?? 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
