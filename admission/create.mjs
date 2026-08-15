#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const required = [
  'artifact', 'repository', 'commit', 'workflow', 'plugin-id', 'plugin-version',
  'distribution', 'host', 'plugin-api-version', 'policy', 'checks', 'sbom',
  'dependency-lock',
];

function fail(message) {
  console.error(`cordon admission create: ${message}`);
  process.exit(1);
}

function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) fail('options require --name value pairs');
    parsed[flag.slice(2)] = value;
  }
  for (const name of required) if (!parsed[name]) fail(`missing --${name}`);
  return parsed;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function json(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {
    fail(`${label} must be valid JSON`);
  }
}

const args = options(process.argv.slice(2));
if (!/^[0-9a-f]{40}$/.test(args.commit)) fail('commit must be an immutable 40-character SHA');
const apiVersion = Number(args['plugin-api-version']);
if (!Number.isSafeInteger(apiVersion) || apiVersion < 1) fail('plugin API version must be a positive integer');
const checks = json(args.checks, 'checks evidence');
const policy = json(args.policy, 'policy');
if (policy.id !== 'cordon.hq-plugin' || policy.schema_version !== 1) fail('policy identity is incompatible');
if (policy.host !== args.host || policy.plugin_api_version !== apiVersion) fail('policy host contract is incompatible');
if (checks.schema_version !== 1 || checks.ok !== true || !Array.isArray(checks.evidence)) {
  fail('checks evidence must be a passing schema_version 1 verdict');
}
const evidence = new Map();
for (const item of checks.evidence) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.status !== 'pass') {
    fail('every evidence item must have a string id and pass status');
  }
  if (evidence.has(item.id)) fail(`duplicate evidence item: ${item.id}`);
  evidence.set(item.id, item);
}
if (!Array.isArray(policy.required_evidence)) fail('policy required_evidence must be an array');
for (const id of policy.required_evidence) {
  if (!evidence.has(id)) fail(`missing required evidence: ${id}`);
}

const statement = {
  ok: true,
  schema_version: 1,
  kind: 'plugin_admission',
  plugin: {
    id: args['plugin-id'],
    version: args['plugin-version'],
    distribution: args.distribution,
  },
  artifact: { name: path.basename(args.artifact), sha256: sha256(args.artifact) },
  source: { repository: args.repository, commit: args.commit, workflow: args.workflow },
  host: { id: args.host, plugin_api_version: apiVersion },
  policy: { id: policy.id, version: policy.schema_version, sha256: sha256(args.policy) },
  evidence: {
    checks_sha256: sha256(args.checks),
    sbom_sha256: sha256(args.sbom),
    dependency_lock_sha256: sha256(args['dependency-lock']),
  },
};
console.log(JSON.stringify(statement));
