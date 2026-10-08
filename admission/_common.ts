import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { errorMessage } from '../lib/guards.ts';

export type Fail = (message: string) => never;

export function failer(prefix: string): Fail {
  return (message) => {
    console.error(`${prefix}: ${message}`);
    process.exit(1);
  };
}

export function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertComplete<K extends string>(
  parsed: Record<string, string>,
  required: readonly K[],
  fail: Fail,
): asserts parsed is Record<K, string> {
  for (const name of required) if (!parsed[name]) fail(`missing --${name}`);
}

// Every option is `--name value`; an unknown flag or a missing value fails.
export function parseOptions<const K extends string>(argv: string[], required: readonly K[], fail: Fail): Record<K, string> {
  const options = Object.fromEntries(required.map((name) => [name, { type: 'string' as const }]));
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options, strict: true, allowPositionals: false }));
  } catch (e) {
    return fail(errorMessage(e));
  }
  const parsed: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) if (typeof value === 'string') parsed[name] = value;
  assertComplete(parsed, required, fail);
  return parsed;
}
