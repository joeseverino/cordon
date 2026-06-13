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
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(import.meta.dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema/cordon-v4.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function errorsFor(doc) {
  return validate(doc) ? [] : (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
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
  const errors = errorsFor(readJson(arg));
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`);
    console.error(`✗ ${arg} is not a valid Cordon contract`);
    process.exit(1);
  }
  console.log(`✓ ${arg} is a valid Cordon contract`);
  process.exit(0);
}

// Fixture-suite mode: valid/ must all pass, invalid/ must all fail.
const fixtures = path.join(root, 'fixtures');
let failures = 0;
const sweep = (dir, mustPass) => {
  const full = path.join(fixtures, dir);
  if (!fs.existsSync(full)) return;
  for (const name of fs.readdirSync(full).filter((n) => n.endsWith('.json')).sort()) {
    const errors = errorsFor(readJson(path.join(full, name)));
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
sweep('valid', true);
sweep('invalid', false);

if (failures) {
  console.error(`\n${failures} fixture(s) did not behave as specified`);
  process.exit(1);
}
console.log('\nall fixtures conform');
