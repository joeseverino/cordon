import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, before, describe, test } from 'node:test';
import { cordonScript } from '../lib/root.ts';

interface Evidence { id: string; status: string }
interface Statement {
  source: { repository: string; workflow: string };
  policy: { sha256: string };
}

describe('admission', () => {
  let temp = '';
  let cosign = '';
  let checksPath = '';
  let statementPath = '';
  let requiredEvidence: Evidence[] = [];
  let statement: Statement;
  let createArgs: string[] = [];
  let base: string[] = [];
  let verifiedEntry = '';
  let entryPath = '';

  const node = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
    spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  const verify = (extra: string[] = [], env: NodeJS.ProcessEnv = {}) =>
    node([...base, ...extra], { ...process.env, CORDON_COSIGN: cosign, ...env });

  before(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-admission-'));
    const artifact = path.join(temp, 'example_notes-1.2.3-py3-none-any.whl');
    const bundle = path.join(temp, 'bundle.json');
    const policyPath = path.join(temp, 'policy.json');
    const sbomPath = path.join(temp, 'sbom.json');
    const lockPath = path.join(temp, 'uv.lock');
    cosign = path.join(temp, 'cosign');
    checksPath = path.join(temp, 'checks.json');
    statementPath = path.join(temp, 'statement.json');
    entryPath = path.join(temp, 'verified-entry.json');
    fs.writeFileSync(artifact, 'wheel bytes');
    fs.writeFileSync(bundle, '{}');
    fs.writeFileSync(cosign, '#!/bin/sh\nexit "${FAKE_COSIGN_EXIT:-0}"\n', { mode: 0o755 });
    fs.writeFileSync(policyPath, JSON.stringify({
      schema_version: 1,
      id: 'cordon.hq-plugin',
      host: 'severino-hq',
      plugin_api_version: 1,
      required_evidence: ['package-tests', 'dependency-audit'],
    }));
    fs.writeFileSync(sbomPath, '{}');
    fs.writeFileSync(lockPath, 'version = 1');

    const evidence = node([cordonScript('admission/evidence'), '--policy', policyPath]);
    assert.equal(evidence.status, 0, `evidence creation failed: ${evidence.stderr}`);
    fs.writeFileSync(checksPath, evidence.stdout);
    requiredEvidence = JSON.parse(evidence.stdout).evidence;

    createArgs = [
      cordonScript('admission/create'),
      '--artifact', artifact,
      '--repository', 'example/example-notes',
      '--commit', 'b'.repeat(40),
      '--workflow', '.github/workflows/admit-plugin.yml',
      '--plugin-id', 'example.notes',
      '--plugin-version', '1.2.3',
      '--distribution', 'example-notes',
      '--host', 'severino-hq',
      '--plugin-api-version', '1',
      '--policy', policyPath,
      '--checks', checksPath,
      '--sbom', sbomPath,
      '--dependency-lock', lockPath,
    ];
    const created = node(createArgs);
    assert.equal(created.status, 0, `admission creation failed: ${created.stderr}`);
    statement = JSON.parse(created.stdout);
    fs.writeFileSync(statementPath, created.stdout);

    base = [
      cordonScript('admission/verify'),
      '--statement', statementPath,
      '--bundle', bundle,
      '--artifact', artifact,
      '--identity', 'https://github.com/example/policy/.github/workflows/admit.yml@refs/heads/main',
      '--issuer', 'https://token.actions.githubusercontent.com',
      '--repository', 'example/example-notes',
      '--workflow', '.github/workflows/admit-plugin.yml',
      '--host', 'severino-hq',
      '--plugin-id', 'example.notes',
      '--policy-sha', statement.policy.sha256,
    ];
  });

  after(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  test('policy derives the canonical passing evidence inventory', () => {
    assert.deepEqual(requiredEvidence.map((item) => item.id), ['package-tests', 'dependency-audit']);
    assert.ok(requiredEvidence.every((item) => item.status === 'pass'));
  });

  test('canonical emitter hashes passing evidence into a predicate', () => {
    assert.equal(statement.source.repository, 'example/example-notes');
  });

  test('missing policy-required evidence fails closed', () => {
    fs.writeFileSync(checksPath, JSON.stringify({ schema_version: 1, ok: true, evidence: requiredEvidence.slice(1) }));
    const incomplete = node(createArgs);
    fs.writeFileSync(checksPath, JSON.stringify({ schema_version: 1, ok: true, evidence: requiredEvidence }));
    assert.notEqual(incomplete.status, 0);
    assert.ok(incomplete.stderr.includes('missing required evidence'), incomplete.stderr);
  });

  test('verified signature, artifact, and expectations pass', () => {
    const pass = verify();
    assert.equal(pass.status, 0, `valid admission failed: ${pass.stderr}`);
    const verdict = JSON.parse(pass.stdout);
    assert.ok(verdict.ok);
    assert.equal(verdict.source_repository, statement.source.repository);
    assert.equal(verdict.source_workflow, statement.source.workflow);
    verifiedEntry = pass.stdout;
    fs.writeFileSync(entryPath, verifiedEntry);
  });

  test('verified entries derive a canonical runtime lock', () => {
    const locked = node([cordonScript('admission/lock'), '--host', 'severino-hq', '--entry', entryPath]);
    assert.equal(locked.status, 0, `canonical lock creation failed: ${locked.stderr}`);
    const lock = JSON.parse(locked.stdout);
    assert.equal(lock.plugins.length, 1);
    assert.equal(lock.plugins[0].plugin, 'example.notes');
  });

  test('duplicate plugin lock entries fail closed', () => {
    const duplicate = node([
      cordonScript('admission/lock'), '--host', 'severino-hq',
      '--entry', entryPath, '--entry', entryPath,
    ]);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /plugin ids must be unique/);
  });

  test('mismatched expected identity fails closed', () => {
    const wrong = [...base];
    wrong[wrong.indexOf('--plugin-id') + 1] = 'example.other';
    const mismatch = node(wrong, { ...process.env, CORDON_COSIGN: cosign });
    assert.notEqual(mismatch.status, 0);
  });

  test('invalid signature fails closed', () => {
    assert.notEqual(verify([], { FAKE_COSIGN_EXIT: '1' }).status, 0);
  });

  test('an unknown option fails with a clear message', () => {
    const unknown = node([...base, '--bogus', 'x']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown option '--bogus'/);
  });

  test('a missing required option names the option', () => {
    const missing = node(base.slice(0, base.indexOf('--identity')).concat(base.slice(base.indexOf('--identity') + 2)));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing --identity/);
  });
});
