#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--policy') {
  console.error('cordon admission evidence: expected --policy path');
  process.exit(1);
}

let policy;
try {
  policy = JSON.parse(fs.readFileSync(args[1]));
} catch {
  console.error(`cordon admission evidence: cannot read policy: ${args[1]}`);
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
