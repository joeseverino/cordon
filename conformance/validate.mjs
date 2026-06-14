#!/usr/bin/env node
// Cordon conformance validator.
//
//   node conformance/validate.mjs            # run the fixture suite (valid must
//                                            # pass, invalid must fail) — the CI gate
//   node conformance/validate.mjs <file>     # validate one contract document
//   cmd --describe | node conformance/validate.mjs -   # validate stdin
//
// One dependency (Ajv). The schema is the contract; this is just the harness an
// implementation in any language points its emitter output at.
//
// Two sibling contracts share this harness: the command-surface contract
// (cordon-v4.json — "what does running this command cost?") and the checks
// verdict (cordon-checks-v1.json — "is this repo shippable, and what fixes
// each failure?"). A document selects its own schema by shape.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(import.meta.dirname, '..');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const compile = (file) => ajv.compile(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
const validateSurface = compile('schema/cordon-v4.json');
const validateChecks = compile('schema/cordon-checks-v1.json');

function errorsFor(validate, doc) {
  return validate(doc) ? [] : (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

// Pick the contract by shape: a command surface has `commands[]`; a checks
// verdict has `checks[]`. Returns null for a document that is neither.
function contractFor(doc) {
  if (doc && typeof doc === 'object') {
    if (Array.isArray(doc.commands)) return { validate: validateSurface, label: 'Cordon contract' };
    if (Array.isArray(doc.checks)) return { validate: validateChecks, label: 'Cordon checks verdict' };
  }
  return null;
}

// Read all of stdin synchronously, tolerating EAGAIN on a non-blocking pipe
// (Node throws it when fd 0 isn't ready yet — retry rather than crash).
function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let bytes;
    try {
      bytes = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN') continue;
      if (e.code === 'EOF') break;
      throw e;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readJson(file) {
  return JSON.parse(file === '-' ? readStdin() : fs.readFileSync(file, 'utf8'));
}

// Single-document mode.
const arg = process.argv[2];
if (arg) {
  const doc = readJson(arg);
  const contract = contractFor(doc);
  if (!contract) {
    console.error(`✗ ${arg} is neither a Cordon contract nor a checks verdict (no commands[] or checks[])`);
    process.exit(1);
  }
  const errors = errorsFor(contract.validate, doc);
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`);
    console.error(`✗ ${arg} is not a valid ${contract.label}`);
    process.exit(1);
  }
  console.log(`✓ ${arg} is a valid ${contract.label}`);
  process.exit(0);
}

// Fixture-suite mode: valid/ must all pass, invalid/ must all fail. Each
// contract owns its own fixture trees, swept against its own schema.
const fixtures = path.join(root, 'fixtures');
let failures = 0;
const sweep = (dir, mustPass, validate) => {
  const full = path.join(fixtures, dir);
  if (!fs.existsSync(full)) return;
  for (const name of fs.readdirSync(full).filter((n) => n.endsWith('.json')).sort()) {
    const errors = errorsFor(validate, readJson(path.join(full, name)));
    const passed = errors.length === 0;
    if (passed === mustPass) {
      console.log(`  ok   ${dir}/${name}`);
    } else {
      failures += 1;
      console.log(`  FAIL ${dir}/${name} — expected ${mustPass ? 'valid' : 'invalid'}`);
      if (!mustPass && passed) console.log(`       (it validated, but this fixture must be rejected)`);
      for (const e of errors) console.log(`       ${e}`);
    }
  }
};
sweep('valid', true, validateSurface);
sweep('invalid', false, validateSurface);
sweep('checks/valid', true, validateChecks);
sweep('checks/invalid', false, validateChecks);

if (failures) {
  console.error(`\n${failures} fixture(s) did not behave as specified`);
  process.exit(1);
}
console.log('\nall fixtures conform');
