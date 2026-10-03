#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Ajv2020, type SchemaObject } from 'ajv/dist/2020.js';
import { cordonAsset } from '../lib/root.ts';

const required = [
  'statement', 'bundle', 'artifact', 'identity', 'issuer', 'repository',
  'workflow', 'host', 'plugin-id', 'policy-sha',
] as const;
type Options = Record<(typeof required)[number], string>;

// The schema-validated shape of schema/cordon-plugin-admission-v1.json.
interface Statement {
  schema_version: number;
  plugin: { id: string; version: string; distribution: string };
  artifact: { name: string; sha256: string };
  source: { repository: string; commit: string; workflow: string };
  host: { id: string; plugin_api_version: number };
  policy: { id: string; version: number; sha256: string };
}

function fail(message: string): never {
  console.error(`cordon admission: ${message}`);
  process.exit(1);
}

function options(argv: string[]): Options {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) fail('options require --name value pairs');
    parsed[flag.slice(2)] = value;
  }
  assertComplete(parsed);
  return parsed;
}

function assertComplete(parsed: Record<string, string>): asserts parsed is Options {
  for (const name of required) if (!parsed[name]) fail(`missing --${name}`);
}

function sha256(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const args = options(process.argv.slice(2));
const schema: SchemaObject = JSON.parse(fs.readFileSync(cordonAsset('schema', 'cordon-plugin-admission-v1.json'), 'utf8'));
const statement: unknown = JSON.parse(fs.readFileSync(args.statement, 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile<Statement>(schema);
if (!validate(statement)) {
  fail(`invalid statement: ${(validate.errors || []).map((item) => `${item.instancePath || '/'} ${item.message}`).join('; ')}`);
}

const cosign = process.env.CORDON_COSIGN || 'cosign';
try {
  execFileSync(cosign, [
    'verify-blob', args.statement,
    '--bundle', args.bundle,
    '--certificate-identity', args.identity,
    '--certificate-oidc-issuer', args.issuer,
  ], { stdio: 'ignore' });
} catch {
  fail('Sigstore bundle or signer identity verification failed');
}

const expectations: [string, string, string][] = [
  ['artifact name', statement.artifact.name, path.basename(args.artifact)],
  ['artifact sha256', statement.artifact.sha256, sha256(args.artifact)],
  ['source repository', statement.source.repository, args.repository],
  ['source workflow', statement.source.workflow, args.workflow],
  ['host id', statement.host.id, args.host],
  ['plugin id', statement.plugin.id, args['plugin-id']],
  ['policy sha256', statement.policy.sha256, args['policy-sha']],
];
for (const [label, actual, expected] of expectations) {
  if (actual !== expected) fail(`${label} mismatch`);
}

console.log(JSON.stringify({
  ok: true,
  schema_version: statement.schema_version,
  plugin: statement.plugin.id,
  version: statement.plugin.version,
  distribution: statement.plugin.distribution,
  host: statement.host.id,
  plugin_api_version: statement.host.plugin_api_version,
  source_repository: statement.source.repository,
  source_workflow: statement.source.workflow,
  source_commit: statement.source.commit,
  signer_identity: args.identity,
  oidc_issuer: args.issuer,
  artifact_sha256: statement.artifact.sha256,
  policy_sha256: statement.policy.sha256,
}));
