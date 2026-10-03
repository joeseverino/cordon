#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

const ENTRY_KEYS = [
  'artifact_sha256', 'distribution', 'host', 'oidc_issuer', 'ok',
  'plugin', 'plugin_api_version', 'policy_sha256', 'schema_version',
  'signer_identity', 'source_commit', 'source_repository', 'source_workflow',
  'version',
].sort();

interface Entry {
  ok: unknown;
  schema_version: unknown;
  host: unknown;
  plugin: string;
}

function fail(message: string): never {
  console.error(`cordon admission lock: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let host: string | undefined;
const files: string[] = [];
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!flag?.startsWith('--') || value === undefined) fail('options require --name value pairs');
  if (flag === '--host' && !host) host = value;
  else if (flag === '--entry') files.push(value);
  else fail(`unknown or repeated option: ${flag}`);
}
if (!host) fail('missing --host');
if (!files.length) fail('at least one --entry is required');

const plugins = files.map((file) => {
  let entry: Entry | null;
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8')) as Entry | null;
  } catch {
    fail(`cannot read verified entry: ${file}`);
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${file} must contain an object`);
  if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(ENTRY_KEYS)) fail(`${file} is not canonical`);
  if (entry.ok !== true || entry.schema_version !== 1 || entry.host !== host) fail(`${file} has an incompatible verdict or host`);
  if (typeof entry.plugin !== 'string' || !entry.plugin) fail(`${file} has an invalid plugin id`);
  return entry;
});
plugins.sort((left, right) => left.plugin.localeCompare(right.plugin));
if (new Set(plugins.map((entry) => entry.plugin)).size !== plugins.length) fail('plugin ids must be unique');

console.log(JSON.stringify({ schema_version: 1, host, plugins }));
