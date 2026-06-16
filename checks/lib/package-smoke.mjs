#!/usr/bin/env node
// package-smoke — build the project's wheel and import it from an isolated
// environment, so a packaging bug (a module left out of the wheel, a broken build
// backend, a bad entry point) fails the gate even when the source tree imports
// fine. The source-tree pytest run never installs the package, so it can't catch
// "works from source, broken once installed" — this can.
//
// Generic for any uv package, and false-positive-proof by construction: it
// no-ops (exit 0) when there's no [build-system] to build or no determinable
// import module, so it can only ever *fail* on a genuine packaging error. The
// build+install happens in an ephemeral env (`uv run --no-project --with .`), not
// the project's .venv, so it's safe to run concurrently with the other checks.
import { spawnSync } from 'node:child_process';
import { readPyproject, importableModule } from './pyproject.mjs';

const root = process.cwd();
const { buildSystem } = readPyproject(root);
if (!buildSystem) {
  console.log('no [build-system] declared — nothing to package');
  process.exit(0);
}
const mod = importableModule(root);
if (!mod) {
  console.log('no importable module determined — skipping packaging smoke');
  process.exit(0);
}

const r = spawnSync('uv', ['run', '--no-project', '--with', '.', 'python', '-c', `import ${mod}`], {
  cwd: root,
  encoding: 'utf8',
});
if (r.status !== 0) {
  process.stdout.write(`${r.stdout || ''}${r.stderr || ''}`);
  console.error(`built package failed to import '${mod}' — the wheel is broken even though the source tree may import`);
  process.exit(1);
}
console.log(`packaged import ok: ${mod}`);
process.exit(0);
