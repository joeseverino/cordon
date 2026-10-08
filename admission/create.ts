#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isRecord } from '../lib/guards.ts';
import { failer, parseOptions, sha256 } from './_common.ts';
import type { Fail } from './_common.ts';

const required = [
  'artifact', 'repository', 'commit', 'workflow', 'plugin-id', 'plugin-version',
  'distribution', 'host', 'plugin-api-version', 'policy', 'checks', 'sbom',
  'dependency-lock',
] as const;

interface PolicyDoc {
  id?: unknown;
  schema_version?: unknown;
  host?: unknown;
  plugin_api_version?: unknown;
  required_evidence?: unknown;
}

interface ChecksDoc {
  schema_version?: unknown;
  ok?: unknown;
  evidence?: unknown;
}

const fail: Fail = failer('cordon admission create');

function json(file: string, label: string): PolicyDoc & ChecksDoc {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return fail(`${label} must be valid JSON`);
  }
}

const args = parseOptions(process.argv.slice(2), required, fail);
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
const items: unknown[] = checks.evidence;
const evidence = new Set<string>();
for (const item of items) {
  if (!isRecord(item) || typeof item['id'] !== 'string' || item['status'] !== 'pass') {
    fail('every evidence item must have a string id and pass status');
  }
  if (evidence.has(item['id'])) fail(`duplicate evidence item: ${item['id']}`);
  evidence.add(item['id']);
}
if (!Array.isArray(policy.required_evidence)) fail('policy required_evidence must be an array');
const requiredIds: unknown[] = policy.required_evidence;
for (const id of requiredIds) {
  if (typeof id !== 'string' || !evidence.has(id)) fail(`missing required evidence: ${String(id)}`);
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
