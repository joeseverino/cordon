#!/usr/bin/env node
// Tests for the Node emitter. Proves the one thing that matters: the declared
// spec converges on the SAME contract the bash and Python emitters produce — the
// committed fixtures. Compared in canonical form (sorted-key compact, the
// byte-deterministic shape a guard diffs), a reconstructed spec equals
// fixtures/valid/leaf-tool.json and fixtures/valid/subcommands.json field-for-field.
//
//   node --test index.test.ts        run the checks
//   node index.test.ts --emit        print the leaf contract (pipe into the validator)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { renderSurface, describeScripts, undeclaredEffects, emitMain, EFFECTS } from './index.ts';
import { cordonAsset } from '../../lib/root.ts';
import type { SurfaceSpec } from './index.ts';

const FIXTURES = cordonAsset('fixtures', 'valid');
const canonical = (d: unknown) => JSON.stringify(sortDeep(d));
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(Reflect.get(v, k))]));
  }
  return v;
}

// The encrypt leaf — the introspect/declare twin of the bash-emitted fixture.
const leafSpec: SurfaceSpec = {
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
const subSpec: SurfaceSpec = {
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
} else {
  registerTests();
}

function registerTests() {
  const parity = (name: string, spec: SurfaceSpec) => {
    test(`byte-parity with fixtures/valid/${name}.json`, { skip: !fs.existsSync(path.join(FIXTURES, `${name}.json`)) }, () => {
      const fixture: unknown = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
      assert.equal(canonical(renderSurface(spec)), canonical(fixture));
    });
  };
  parity('leaf-tool', leafSpec);
  parity('subcommands', subSpec);

  const pkg = {
    name: 'demo',
    description: 'A demo npm repo.',
    scripts: {
      build: 'some-engine build --out dist',
      deploy: 'wrangler deploy',
      describe: 'node bin/demo --describe', // plumbing, not in `effects`, so excluded
    },
  };
  const derived = describeScripts(pkg, {
    group: 'Integrations',
    order: 10,
    effects: { build: 'local_write', deploy: 'deploy' },
    network: { deploy: true },
  });
  const doc = renderSurface(derived);

  test('introspect: only scripts in `effects` become commands (plumbing excluded)', () => {
    assert.equal(doc.commands.length, 2);
  });

  test('introspect: a command delegates to the literal script it runs (derived, not declared)', () => {
    assert.equal(doc.commands[0]?.delegates, 'some-engine build --out dist');
  });

  test('introspect: declared blast radius + network ride into the command', () => {
    const deploy = doc.commands.find((c) => c.name === 'deploy');
    assert.ok(deploy?.effect === 'deploy' && deploy.network === true);
  });

  test('introspect: `effects` naming a missing script is an error', () => {
    assert.throws(() => describeScripts(pkg, { group: 'G', order: 1, effects: { nope: 'read' } }));
  });

  test('rejects an effect off the ladder', () => {
    assert.throws(() => renderSurface(JSON.parse('{"name":"x","group":"G","order":1,"effect":"nuke"}')));
  });

  test('reports a command that defaulted its effect', () => {
    assert.equal(undeclaredEffects({ name: 'x', group: 'G', order: 1, commands: [{ name: 'c' }] }).length, 1);
  });

  test('effect ladder spans read..deploy', () => {
    assert.ok(EFFECTS[0] === 'read' && EFFECTS.at(-1) === 'deploy');
  });

  test('emitMain accepts dir and url as the contract root', () => {
    const calls: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => { calls.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      const spec: SurfaceSpec = { name: 'rooted', group: 'G', order: 1, effect: 'read' };
      const here = path.join(os.tmpdir(), 'cordon-emit-root');
      fs.rmSync(here, { recursive: true, force: true });
      fs.mkdirSync(path.join(here, 'bin'), { recursive: true });
      emitMain(spec, { dir: path.join(here, 'bin'), argv: ['--write'] });
      assert.ok(fs.existsSync(path.join(here, 'contract', 'rooted.json')), 'dir roots the contract');
      fs.rmSync(path.join(here, 'contract'), { recursive: true });
      emitMain(spec, { url: pathToFileURL(path.join(here, 'bin', 'emit.ts')).href, argv: ['--write'] });
      assert.ok(fs.existsSync(path.join(here, 'contract', 'rooted.json')), 'url still roots the contract');
      fs.rmSync(here, { recursive: true, force: true });
    } finally {
      process.stderr.write = write;
    }
    assert.equal(calls.length, 2);
  });
}
