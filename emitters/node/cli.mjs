#!/usr/bin/env node
// Zero-touch emitter: derive a contract from any repo's package.json scripts —
// no emitter script in the target repo required. Name the exposed scripts and
// their blast radius; pipe it into the validator to prove conformance:
//
//   node cli.mjs ../some-repo/package.json -g Integrations -o 150 \
//     -e build=local_write,deploy=deploy
//   node cli.mjs ./package.json -g X -o 1 -e build=local_write \
//     | node "$CORDON_HOME/conformance/validate.mjs" -
//
// The surface (command names + what each delegates to) is read from `scripts`;
// `-e/--effects` supplies the one fact scripts can't carry (each command's blast
// radius) and selects which scripts are part of the public surface.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { describeScripts, renderSurface, serialize } from './index.mjs';

function parseArgs(argv) {
  const out = { effects: {}, compact: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compact') out.compact = true;
    else if (a === '-g' || a === '--group') out.group = argv[++i];
    else if (a === '-o' || a === '--order') out.order = Number(argv[++i]);
    else if (a === '-n' || a === '--name') out.name = argv[++i];
    else if (a === '-e' || a === '--effects') {
      for (const pair of (argv[++i] ?? '').split(',').filter(Boolean)) {
        const [script, effect] = pair.split('=');
        out.effects[script] = effect;
      }
    } else if (!a.startsWith('-')) out.target = a;
  }
  return out;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.target || !opts.group || !Number.isInteger(opts.order)) {
    process.stderr.write('usage: node cli.mjs <package.json> -g <group> -o <order> -e <script>=<effect>[,...]\n');
    return 2;
  }
  const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), opts.target), 'utf8'));
  const spec = describeScripts(pkg, { effects: opts.effects, group: opts.group, order: opts.order, name: opts.name });
  process.stdout.write(serialize(renderSurface(spec), { compact: opts.compact }));
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`cordon: ${err.message}\n`);
    process.exit(1);
  });
