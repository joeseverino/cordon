#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { errorMessage, isRecord } from '../lib/guards.ts';
import { failer } from './_common.ts';
import type { Fail } from './_common.ts';

const ENTRY_KEYS = [
  'artifact_sha256', 'distribution', 'host', 'oidc_issuer', 'ok',
  'plugin', 'plugin_api_version', 'policy_sha256', 'schema_version',
  'signer_identity', 'source_commit', 'source_repository', 'source_workflow',
  'version',
].toSorted();

const fail: Fail = failer('cordon admission lock');

let values;
try {
  ({ values } = parseArgs({
    args: process.argv.slice(2),
    options: { host: { type: 'string', multiple: true }, entry: { type: 'string', multiple: true } },
    strict: true,
    allowPositionals: false,
  }));
} catch (e) {
  fail(errorMessage(e));
}
const hosts = values.host ?? [];
const files = values.entry ?? [];
if (hosts.length > 1) fail('unknown or repeated option: --host');
const host = hosts[0];
if (!host) fail('missing --host');
if (!files.length) fail('at least one --entry is required');

const plugins = files.map((file) => {
  let entry: unknown;
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`cannot read verified entry: ${file}`);
  }
  if (!isRecord(entry)) fail(`${file} must contain an object`);
  if (JSON.stringify(Object.keys(entry).toSorted()) !== JSON.stringify(ENTRY_KEYS)) fail(`${file} is not canonical`);
  if (entry['ok'] !== true || entry['schema_version'] !== 1 || entry['host'] !== host) fail(`${file} has an incompatible verdict or host`);
  const plugin = entry['plugin'];
  if (typeof plugin !== 'string' || !plugin) fail(`${file} has an invalid plugin id`);
  return { ...entry, plugin };
});
const sorted = plugins.toSorted((left, right) => left.plugin.localeCompare(right.plugin));
if (new Set(sorted.map((entry) => entry.plugin)).size !== sorted.length) fail('plugin ids must be unique');

console.log(JSON.stringify({ schema_version: 1, host, plugins: sorted }));
