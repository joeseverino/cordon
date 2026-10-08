#!/usr/bin/env node
// Zero-touch emitter: derive a contract from any repo's package.json scripts —
// no emitter script in the target repo required. Name the exposed scripts and
// their blast radius; pipe it into the validator to prove conformance:
//
//   cordon-emit ../some-repo/package.json -g Integrations -o 150 \
//     -e build=local_write,deploy=deploy
//   cordon-emit ./package.json -g X -o 1 -e build=local_write | cordon-validate -
//
// The surface (command names + what each delegates to) is read from `scripts`;
// `-e/--effects` supplies the one fact scripts can't carry (each command's blast
// radius) and selects which scripts are part of the public surface.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { errorMessage, isRecord } from '../../lib/guards.ts';
import { describeScripts, renderSurface, serialize } from './index.ts';
import type { PackageJson } from './index.ts';

const USAGE = 'usage: cordon-emit <package.json> -g <group> -o <order> -e <script>=<effect>[,...]\n';

function readPackage(raw: unknown, fallbackName: string | undefined): PackageJson {
  if (!isRecord(raw)) throw new Error('package.json must be a JSON object');
  const name = typeof raw['name'] === 'string' ? raw['name'] : fallbackName;
  if (name === undefined) throw new Error('package.json has no name (pass -n)');
  const scripts: Record<string, string> = {};
  if (isRecord(raw['scripts'])) {
    for (const [key, value] of Object.entries(raw['scripts'])) if (typeof value === 'string') scripts[key] = value;
  }
  const description = raw['description'];
  return { name, scripts, ...(typeof description === 'string' ? { description } : {}) };
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        group: { type: 'string', short: 'g' },
        order: { type: 'string', short: 'o' },
        name: { type: 'string', short: 'n' },
        effects: { type: 'string', short: 'e', multiple: true },
        compact: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    process.stderr.write(`cordon: ${errorMessage(e)}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const order = values.order === undefined ? undefined : Number(values.order);
  const [target, ...extra] = positionals;
  if (!target || extra.length > 0 || !values.group || order === undefined || !Number.isInteger(order)) {
    process.stderr.write(USAGE);
    return 2;
  }
  const effects: Record<string, string | undefined> = {};
  for (const pair of (values.effects ?? []).flatMap((list) => list.split(',')).filter(Boolean)) {
    const [script = '', effect] = pair.split('=');
    effects[script] = effect;
  }
  const raw: unknown = JSON.parse(await readFile(path.resolve(process.cwd(), target), 'utf8'));
  const pkg = readPackage(raw, values.name);
  const spec = describeScripts(pkg, { effects, group: values.group, order, name: values.name });
  process.stdout.write(serialize(renderSurface(spec), { compact: Boolean(values.compact) }));
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`cordon: ${errorMessage(err)}\n`);
  process.exitCode = 1;
}
