import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-admission-'));
const artifact = path.join(temp, 'example_notes-1.2.3-py3-none-any.whl');
const statementPath = path.join(temp, 'statement.json');
const bundle = path.join(temp, 'bundle.json');
const cosign = path.join(temp, 'cosign');
const policyPath = path.join(temp, 'policy.json');
const checksPath = path.join(temp, 'checks.json');
const sbomPath = path.join(temp, 'sbom.json');
const lockPath = path.join(temp, 'uv.lock');
fs.writeFileSync(artifact, 'wheel bytes');
fs.writeFileSync(bundle, '{}');
fs.writeFileSync(cosign, '#!/bin/sh\nexit "${FAKE_COSIGN_EXIT:-0}"\n', { mode: 0o755 });
const policy = {
  schema_version: 1,
  id: 'cordon.hq-plugin',
  host: 'severino-hq',
  plugin_api_version: 1,
  required_evidence: ['package-tests', 'dependency-audit'],
};
fs.writeFileSync(policyPath, JSON.stringify(policy));
const emittedEvidence = spawnSync(process.execPath, [
  path.join(root, 'admission/evidence.mjs'), '--policy', policyPath,
], { encoding: 'utf8' });
if (emittedEvidence.status !== 0) throw new Error(`evidence creation failed: ${emittedEvidence.stderr}`);
fs.writeFileSync(checksPath, emittedEvidence.stdout);
const requiredEvidence = JSON.parse(emittedEvidence.stdout).evidence;
console.log('  ok   policy derives the canonical passing evidence inventory');
fs.writeFileSync(sbomPath, '{}');
fs.writeFileSync(lockPath, 'version = 1');

const createArgs = [
  path.join(root, 'admission/create.mjs'),
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
const created = spawnSync(process.execPath, createArgs, { encoding: 'utf8' });
if (created.status !== 0) throw new Error(`admission creation failed: ${created.stderr}`);
const statement = JSON.parse(created.stdout);
fs.writeFileSync(statementPath, created.stdout);
console.log('  ok   canonical emitter hashes passing evidence into a predicate');

fs.writeFileSync(checksPath, JSON.stringify({
  schema_version: 1,
  ok: true,
  evidence: requiredEvidence.slice(1),
}));
const incomplete = spawnSync(process.execPath, createArgs, { encoding: 'utf8' });
if (incomplete.status === 0 || !incomplete.stderr.includes('missing required evidence')) {
  throw new Error('incomplete evidence passed admission creation');
}
console.log('  ok   missing policy-required evidence fails closed');
fs.writeFileSync(checksPath, JSON.stringify({
  schema_version: 1,
  ok: true,
  evidence: requiredEvidence,
}));

const base = [
  path.join(root, 'admission/verify.mjs'),
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
const run = (extra = [], env = {}) => spawnSync(process.execPath, [...base, ...extra], {
  env: { ...process.env, CORDON_COSIGN: cosign, ...env }, encoding: 'utf8',
});

const pass = run();
const verdict = JSON.parse(pass.stdout);
if (pass.status !== 0 || !verdict.ok) throw new Error(`valid admission failed: ${pass.stderr}`);
if (verdict.source_repository !== statement.source.repository || verdict.source_workflow !== statement.source.workflow) {
  throw new Error('verified source identity missing from verdict');
}
console.log('  ok   verified signature, artifact, and expectations pass');

const entryPath = path.join(temp, 'verified-entry.json');
fs.writeFileSync(entryPath, pass.stdout);
const locked = spawnSync(process.execPath, [
  path.join(root, 'admission/lock.mjs'), '--host', 'severino-hq', '--entry', entryPath,
], { encoding: 'utf8' });
const lock = JSON.parse(locked.stdout);
if (locked.status !== 0 || lock.plugins.length !== 1 || lock.plugins[0].plugin !== 'example.notes') {
  throw new Error(`canonical lock creation failed: ${locked.stderr}`);
}
console.log('  ok   verified entries derive a canonical runtime lock');

const duplicateLock = spawnSync(process.execPath, [
  path.join(root, 'admission/lock.mjs'), '--host', 'severino-hq',
  '--entry', entryPath, '--entry', entryPath,
], { encoding: 'utf8' });
if (duplicateLock.status === 0) throw new Error('duplicate plugin lock entry passed');
console.log('  ok   duplicate plugin lock entries fail closed');

const wrongArtifact = [...base];
wrongArtifact[wrongArtifact.indexOf('--plugin-id') + 1] = 'example.other';
const mismatch = spawnSync(process.execPath, wrongArtifact, {
  env: { ...process.env, CORDON_COSIGN: cosign }, encoding: 'utf8',
});
if (mismatch.status === 0) throw new Error('mismatched plugin identity passed');
console.log('  ok   mismatched expected identity fails closed');

const unsigned = run([], { FAKE_COSIGN_EXIT: '1' });
if (unsigned.status === 0) throw new Error('invalid signature passed');
console.log('  ok   invalid signature fails closed');

fs.rmSync(temp, { recursive: true, force: true });
console.log('admission verifier self-test passed');
