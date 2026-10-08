#!/usr/bin/env node
// Cordon conformance validator.
//
//   node conformance/validate.ts            # run the fixture suite (valid must
//                                            # pass, invalid must fail) — the CI gate
//   node conformance/validate.ts <file>     # validate one contract document
//   cmd --describe | node conformance/validate.ts -   # validate stdin
//
// One dependency (Ajv). The schema is the contract; this is just the harness an
// implementation in any language points its emitter output at.
//
// Two sibling contracts share this harness: the command-surface contract
// (cordon-v4.json — "what does running this command cost?") and the checks
// verdict (cordon-checks-vN.json — "is this repo shippable, and what fixes each
// failure?"). A document selects its contract by shape, and a checks verdict
// then selects its schema version by `schema_version`, so v1 and v2 fixtures
// coexist under one sweep with no per-file wiring.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { checksSemanticErrors, surfaceSemanticErrors } from './semantics.ts';
import { cordonAsset } from '../lib/root.ts';
import { errorMessage } from '../lib/guards.ts';
import type { ChecksVerdict } from './semantics.ts';
import type { CordonContract } from '../emitters/node/index.ts';

// The fields contract selection reads off an arbitrary parsed document.
interface Probe {
  kind?: unknown;
  commands?: unknown;
  checks?: unknown;
  schema_version?: unknown;
}

interface Contract {
  errors: (doc: unknown) => string[];
  label: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const compile = <T>(file: string): ValidateFunction<T> => ajv.compile<T>(JSON.parse(fs.readFileSync(cordonAsset(file), 'utf8')));
const validateSurface = compile<CordonContract>('schema/cordon-v4.json');
const validatePluginAdmission = compile('schema/cordon-plugin-admission-v1.json');
const latestChecks = compile<ChecksVerdict>('schema/cordon-checks-v3.json');
const checksValidators: Record<string, ValidateFunction<ChecksVerdict>> = { 1: compile('schema/cordon-checks-v1.json'), 2: compile('schema/cordon-checks-v2.json'), 3: latestChecks };
// A checks verdict pins its schema by `schema_version`; an unrecognized value
// validates against the latest (its `const` keyword then rejects it — so a
// missing/wrong version fails, as an invalid fixture should).
const validateChecks = (doc: Probe) => (checksValidators[String(doc?.schema_version)] ?? latestChecks);

function errorsFor<T>(validate: ValidateFunction<T>, semantics: (doc: T) => string[], doc: unknown): string[] {
  if (!validate(doc)) {
    return (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  }
  return semantics(doc);
}

// Pick the contract by shape: a command surface has `commands[]`; a checks
// verdict has `checks[]` (and selects its schema version from the document).
// Returns null for a document that is neither.
function contract<T>(validate: ValidateFunction<T>, semantics: (doc: T) => string[], label: string): Contract {
  return { errors: (doc) => errorsFor(validate, semantics, doc), label };
}

function contractFor(input: unknown): Contract | null {
  if (input && typeof input === 'object') {
    const doc: Probe = input;
    if (doc.kind === 'plugin_admission') {
      return contract(validatePluginAdmission, () => [], 'Cordon plugin admission');
    }
    if (Array.isArray(doc.commands)) {
      return contract(validateSurface, surfaceSemanticErrors, 'Cordon contract');
    }
    if (Array.isArray(doc.checks)) {
      return contract(validateChecks(doc), checksSemanticErrors, 'Cordon checks verdict');
    }
  }
  return null;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(file === '-' ? await text(process.stdin) : fs.readFileSync(file, 'utf8'));
}

async function validateOne(arg: string): Promise<number> {
  const doc = await readJson(arg);
  const contract = contractFor(doc);
  if (!contract) {
    console.error(`✗ ${arg} is neither a Cordon contract nor a checks verdict (no commands[] or checks[])`);
    return 1;
  }
  const errors = contract.errors(doc);
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`);
    console.error(`✗ ${arg} is not a valid ${contract.label}`);
    return 1;
  }
  console.log(`✓ ${arg} is a valid ${contract.label}`);
  return 0;
}

// Fixture-suite mode: valid/ must all pass, invalid/ must all fail. Each fixture
// resolves its own contract (and a checks verdict its own schema version) the
// same way a real `--describe`/`--json` document would, so the suite tests the
// exact selection logic the single-document path uses.
function sweepFixtures(): number {
  const fixtures = cordonAsset('fixtures');
  let failures = 0;
  const sweep = (dir: string, mustPass: boolean) => {
    const full = path.join(fixtures, dir);
    if (!fs.existsSync(full)) return;
    for (const name of fs.readdirSync(full).filter((n) => n.endsWith('.json')).toSorted()) {
      const doc: unknown = JSON.parse(fs.readFileSync(path.join(full, name), 'utf8'));
      const contract = contractFor(doc);
      const errors = contract
        ? contract.errors(doc)
        : ['document is neither a Cordon contract nor a checks verdict (no commands[] or checks[])'];
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
  sweep('checks/valid', true);
  sweep('checks/invalid', false);
  sweep('admission/valid', true);
  sweep('admission/invalid', false);

  if (failures) {
    console.error(`\n${failures} fixture(s) did not behave as specified`);
    return 1;
  }
  console.log('\nall fixtures conform');
  return 0;
}

let positionals: string[];
try {
  ({ positionals } = parseArgs({ allowPositionals: true, strict: true }));
} catch (e) {
  console.error(`cordon-validate: ${errorMessage(e)}`);
  process.exit(2);
}
if (positionals.length > 1) {
  console.error('cordon-validate: expected at most one file (use - for stdin)');
  process.exit(2);
}
const [arg] = positionals;
process.exitCode = arg ? await validateOne(arg) : sweepFixtures();
