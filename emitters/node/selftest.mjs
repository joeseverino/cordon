#!/usr/bin/env node
// Selftest for the Node emitter. Proves the one thing that matters: the declared
// spec converges on the SAME contract the bash and Python emitters produce — the
// committed fixtures. Compared in canonical form (sorted-key compact, the
// byte-deterministic shape a guard diffs), a reconstructed spec equals
// fixtures/valid/leaf-tool.json and fixtures/valid/subcommands.json field-for-field.
//
//   node selftest.mjs          run the checks
//   node selftest.mjs --emit   print the leaf contract (pipe into the validator)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { renderSurface, describeScripts, undeclaredEffects, EFFECTS } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', 'fixtures', 'valid');
const canonical = (d) => JSON.stringify(sortDeep(d));
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  }
  return v;
}

// The encrypt leaf — the introspect/declare twin of the bash-emitted fixture.
const leafSpec = {
  name: 'encrypt',
  description: 'Encrypt files to your default age public key.',
  group: 'Crypto',
  order: 40,
  effect: 'local_write',
  options: [
    { flags: ['-c', '--copy'], help: 'Keep the original file (encrypt a copy)' },
    { flags: ['-k', '--key'], metavar: 'PATH', takesValue: true, repeatable: true, help: 'Add another public key as a recipient' },
  ],
  positionals: [{ name: 'file', help: 'File(s) to encrypt', variadic: true }],
  paras: ['Encrypts each file in place to your configured age recipients; pass --copy to keep the original alongside the .age output.'],
  examples: [['encrypt notes.md', 'original removed']],
};

// The hq subcommand tool — per-command effects, a choices positional, a delegate.
const subSpec = {
  name: 'hq',
  description: 'Sync vault docs into the ops app and operate the deploy.',
  group: 'Integrations',
  order: 130,
  effect: 'read',
  commands: [
    { name: 'logs', summary: 'Show app container logs (default tail 50)', effect: 'read', network: true,
      options: [{ flags: ['-f', '--follow'], help: 'Stream live output until Ctrl-C' }] },
    { name: 'restart', summary: 'docker compose restart app — no rebuild, no migrations', effect: 'deploy', network: true },
    { name: 'create', summary: 'Create or update a Project or Asset (idempotent upsert by slug)', effect: 'remote_write', network: true,
      positionals: [{ name: 'kind', help: 'What to create', choices: ['project', 'asset'] }],
      delegates: "the app's create_project / create_asset management commands" },
  ],
};

if (process.argv.includes('--emit')) {
  process.stdout.write(JSON.stringify(renderSurface(leafSpec), null, 2) + '\n');
  process.exit(0);
}

let failed = 0;
const check = (ok, label) => {
  process.stderr.write(`${ok ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!ok) failed += 1;
};

function parity(name, spec) {
  const file = path.join(FIXTURES, `${name}.json`);
  if (!fs.existsSync(file)) {
    process.stderr.write(`skip parity: ${file} not found\n`);
    return;
  }
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  const emitted = renderSurface(spec);
  check(canonical(emitted) === canonical(fixture), `byte-parity with fixtures/valid/${name}.json`);
}

parity('leaf-tool', leafSpec);
parity('subcommands', subSpec);

// Introspect: a surface derived from package.json scripts, not declared.
const pkg = {
  name: 'demo',
  description: 'A demo npm repo.',
  scripts: {
    build: 'some-engine build --out dist',
    deploy: 'wrangler deploy',
    describe: 'node bin/demo --describe', // plumbing — not in `effects`, so excluded
  },
};
const derived = describeScripts(pkg, {
  group: 'Integrations',
  order: 10,
  effects: { build: 'local_write', deploy: 'deploy' },
  network: { deploy: true },
});
const doc = renderSurface(derived);
check(doc.commands.length === 2, 'introspect: only scripts in `effects` become commands (plumbing excluded)');
check(
  doc.commands[0].delegates === 'some-engine build --out dist',
  'introspect: a command delegates to the literal script it runs (derived, not declared)',
);
check(
  doc.commands.find((c) => c.name === 'deploy')?.effect === 'deploy' &&
    doc.commands.find((c) => c.name === 'deploy')?.network === true,
  'introspect: declared blast radius + network ride into the command',
);
let scriptThrew = false;
try { describeScripts(pkg, { group: 'G', order: 1, effects: { nope: 'read' } }); } catch { scriptThrew = true; }
check(scriptThrew, 'introspect: `effects` naming a missing script is an error');

// Effect honesty: an off-ladder effect is rejected, not silently emitted.
let threw = false;
try { renderSurface({ name: 'x', group: 'G', order: 1, effect: 'nuke' }); } catch { threw = true; }
check(threw, 'rejects an effect off the ladder');

// A command with no declared effect is reported (the fail-open guard).
check(
  undeclaredEffects({ name: 'x', group: 'G', order: 1, commands: [{ name: 'c' }] }).length === 1,
  'reports a command that defaulted its effect',
);
check(EFFECTS[0] === 'read' && EFFECTS.at(-1) === 'deploy', 'effect ladder spans read..deploy');

process.exit(failed ? 1 : 0);
