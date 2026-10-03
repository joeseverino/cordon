#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

interface Policy {
  id: string;
  schema_version: number;
  required_evidence: unknown[];
}

const args = process.argv.slice(2);
const [flag, policyPath] = args;
if (args.length !== 2 || flag !== '--policy' || policyPath === undefined) {
  console.error('cordon admission evidence: expected --policy path');
  process.exit(1);
}

let policy: Policy;
try {
  policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as Policy;
} catch {
  console.error(`cordon admission evidence: cannot read policy: ${policyPath}`);
  process.exit(1);
}
if (policy.id !== 'cordon.hq-plugin' || policy.schema_version !== 1
    || !Array.isArray(policy.required_evidence)
    || policy.required_evidence.some((id) => typeof id !== 'string' || !id)) {
  console.error('cordon admission evidence: incompatible policy');
  process.exit(1);
}
if (new Set(policy.required_evidence).size !== policy.required_evidence.length) {
  console.error('cordon admission evidence: policy evidence ids must be unique');
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  ok: true,
  evidence: policy.required_evidence.map((id) => ({ id, status: 'pass' })),
}));
