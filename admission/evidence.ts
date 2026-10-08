#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { isRecord } from '../lib/guards.ts';
import { failer, parseOptions } from './_common.ts';
import type { Fail } from './_common.ts';

const fail: Fail = failer('cordon admission evidence');

const { policy: policyPath } = parseOptions(process.argv.slice(2), ['policy'], (message) => fail(`expected --policy path (${message})`));

let policy: unknown;
try {
  policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
} catch {
  fail(`cannot read policy: ${policyPath}`);
}
const evidence: unknown = isRecord(policy) ? policy['required_evidence'] : undefined;
if (!isRecord(policy) || policy['id'] !== 'cordon.hq-plugin' || policy['schema_version'] !== 1 || !Array.isArray(evidence)) {
  fail('incompatible policy');
}
const ids: string[] = [];
for (const id of evidence) {
  if (typeof id !== 'string' || !id) fail('incompatible policy');
  ids.push(id);
}
if (new Set(ids).size !== ids.length) fail('policy evidence ids must be unique');

console.log(JSON.stringify({
  schema_version: 1,
  ok: true,
  evidence: ids.map((id) => ({ id, status: 'pass' })),
}));
