#!/usr/bin/env node
// Hermetic self-test for the checks engine — the run-logic sibling of the
// conformance fixture sweep. The fixtures prove a *verdict shape* is valid; this
// proves the *engine* actually produces the right verdict: invariants fire,
// command entries spawn, capability gating skips fail-soft with the right
// `unmet`, phases order, and — closing the loop — the emitter's real `--json`
// output validates against the published v2 schema. Zero deps; same terse
// ok/FAIL output as conformance/validate.mjs so `npm test` reads as one suite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePyproject, importableModule } from './lib/pyproject.mjs';
import { CATALOG } from './catalog.mjs';
import dispatchDups from './lib/dispatch-dups.mjs';
import batsAssertions from './lib/bats-assertions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const check = (name, cond, detail = '') => {
  if (cond) return ok(name);
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};

// A scratch repo: a built tree with a broken link, a duplicate id, and an
// alt-less image (both post-build invariants must fail), plus three command
// entries — one that passes, one gated behind a missing binary, one that fails.
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-selftest-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'),
    '<!doctype html><html><body>'
    + '<a id="dup" href="/missing/">x</a><a id="dup" href="/">home</a>'
    + '<img src="/logo.png"></body></html>');
  fs.writeFileSync(path.join(dir, 'cordon.checks.json'), JSON.stringify({
    commands: [
      { id: 'smoke', name: 'Smoke', effect: 'read', exec: { cmd: 'true' } },
      { id: 'needs-tool', name: 'Needs missing tool', effect: 'local_write', requires: ['definitely-not-a-real-binary-xyz'], exec: { cmd: 'true' } },
      { id: 'bad-spawn', name: 'Undeclared missing binary', effect: 'read', exec: { cmd: 'definitely-not-a-real-binary-xyz', args: ['check'] } },
      { id: 'will-fail', name: 'Will fail', effect: 'read', exec: { cmd: 'false' } },
    ],
  }, null, 2));
  return dir;
}

const runJson = (root) => {
  const r = spawnSync('node', ['checks/run.mjs', '--root', root, '--json'], { cwd: repo, encoding: 'utf8' });
  return { verdict: JSON.parse(r.stdout), code: r.status };
};
const rowsById = (verdict) => Object.fromEntries(verdict.checks.map((c) => [c.id, c]));

const dir = scratchRepo();
try {
  const { verdict, code } = runJson(dir);
  const by = rowsById(verdict);

  check('emits schema_version 2', verdict.schema_version === 2);
  check('exit code is non-zero on failure', code === 1, `got ${code}`);
  check('ok reflects failures', verdict.ok === false);
  check('failed lists the broken invariants', ['internal-links', 'structural-html'].every((id) => verdict.failed.includes(id)), verdict.failed.join(','));
  check('internal-links fails on the broken href', by['internal-links']?.status === 'fail');
  check('structural-html fails on dup id / missing alt', by['structural-html']?.status === 'fail');
  check('a failed check carries fix + rerun', Boolean(by['internal-links']?.fix && by['internal-links']?.rerun));
  check('command with met deps runs and passes', by.smoke?.status === 'pass');
  check('command with a failing exit fails', by['will-fail']?.status === 'fail');
  check('command gated by a missing binary skips', by['needs-tool']?.status === 'skip');
  check('the skip names the unmet capability', by['needs-tool']?.unmet?.includes('definitely-not-a-real-binary-xyz'));
  // A command whose binary can't be spawned (ENOENT) and was NOT declared in
  // requires must SKIP fail-soft, never FAIL — the false-RED the gate must avoid.
  check('an undeclared missing binary skips, not fails', by['bad-spawn']?.status === 'skip', by['bad-spawn']?.status);
  check('the spawn skip names the missing command in unmet', by['bad-spawn']?.unmet?.includes('definitely-not-a-real-binary-xyz'), JSON.stringify(by['bad-spawn']?.unmet));
  check('multi-phase run emits phase on every row', verdict.checks.every((c) => typeof c.phase === 'string'));
  check('post-build invariants run after build-output exists', by['internal-links']?.phase === 'post-build');

  // Close the loop: the emitter's real output must validate against the schema
  // the fixtures pin — the engine can't drift from its own contract.
  const verdictFile = path.join(dir, 'verdict.json');
  fs.writeFileSync(verdictFile, JSON.stringify(verdict));
  const conform = spawnSync('node', ['conformance/validate.mjs', verdictFile], { cwd: repo, encoding: 'utf8' });
  check('the live verdict validates against cordon-checks-v2', conform.status === 0, conform.stdout.trim() || conform.stderr.trim());

  // A failing gate must publish its report to the CI step summary, so a red run
  // is never silent (the recurring "exit 1, no cordon summary"). The engine owns
  // this — it must not depend on the calling workflow catting a file.
  const summaryFile = path.join(dir, 'step-summary.md');
  const sumRun = spawnSync('node', ['checks/run.mjs', '--root', dir, '--json'],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile } });
  const summaryText = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  check('a failing gate exits non-zero', sumRun.status === 1, `got ${sumRun.status}`);
  check('a failing gate publishes its report to $GITHUB_STEP_SUMMARY', /Cordon checks —/.test(summaryText));

  // A bare repo (no build, no config) runs only the always-available invariants,
  // and the post-build ones skip rather than fail — the lean default posture.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-selftest-bare-'));
  try {
    const { verdict: v2 } = runJson(bare);
    const b = rowsById(v2);
    check('bare repo: post-build invariant skips, not fails', b['internal-links']?.status === 'skip');
    check('bare repo: the skip is capability-driven (built-dir)', b['internal-links']?.unmet?.includes('built-dir'));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// — The Python version matrix: pyproject classifiers drive a one-check,
// run-once-per-version pytest, with no CI matrix. First the pure resolution
// (parsing + the catalog's expand seam), then the engine end-to-end. —
{
  const sample = [
    '[project]',
    'name = "x"',
    'requires-python = ">=3.11"',
    'classifiers = [',
    '  "Programming Language :: Python :: 3.11",',
    '  "Programming Language :: Python :: 3.12",',
    '  "Programming Language :: Python :: 3.13",',
    ']',
    '[project.optional-dependencies]',
    'dev = ["pytest"]',
  ].join('\n');
  const parsed = parsePyproject(sample);
  check('pyproject: extracts version classifiers in order', JSON.stringify(parsed.versions) === JSON.stringify(['3.11', '3.12', '3.13']), JSON.stringify(parsed.versions));
  check('pyproject: detects the dev extra group', parsed.extras.includes('dev'));

  const pytest = CATALOG.find((c) => c.id === 'pytest');
  check('catalog: pytest declares an expand seam', typeof pytest.expand === 'function');

  const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pyproj-'));
  try {
    fs.writeFileSync(path.join(pdir, 'pyproject.toml'), sample);
    const auto = pytest.expand({ root: pdir, config: {} });
    check('pytest matrix: auto-derives one variant per classifier', auto?.length === 3, String(auto?.length));
    check('pytest matrix: each variant pins --python and adds the dev extra',
      ['3.11', '3.12', '3.13'].every((v, i) => auto[i].args.join(' ') === `run --python ${v} --extra dev pytest -q`),
      JSON.stringify(auto?.map((v) => v.args)));
    check('pytest matrix: explicit pythonVersions overrides classifiers',
      pytest.expand({ root: pdir, config: { pythonVersions: ['3.12'] } })?.length === 1);
    check('pytest matrix: empty pythonVersions opts out to a single run',
      pytest.expand({ root: pdir, config: { pythonVersions: [] } }) === null);
  } finally {
    fs.rmSync(pdir, { recursive: true, force: true });
  }

  const ndir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pyproj-none-'));
  try {
    fs.writeFileSync(path.join(ndir, 'pyproject.toml'), '[project]\nname = "x"\n');
    check('pytest matrix: no classifiers ⇒ single default run', pytest.expand({ root: ndir, config: {} }) === null);
  } finally {
    fs.rmSync(ndir, { recursive: true, force: true });
  }

  // End-to-end: a stubbed `uv` on PATH proves expand → per-version loop → one
  // aggregated row, with no real Python or network. The repo declares two
  // classifiers and a uv.lock so the catalog's pytest (and ruff) light up.
  const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-matrix-'));
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-bin-'));
  try {
    fs.writeFileSync(path.join(mdir, 'pyproject.toml'),
      '[project]\nname = "x"\nclassifiers = [\n  "Programming Language :: Python :: 3.11",\n  "Programming Language :: Python :: 3.12",\n]\n');
    fs.writeFileSync(path.join(mdir, 'uv.lock'), '');
    const shim = path.join(bindir, 'uv');
    fs.writeFileSync(shim, '#!/bin/sh\necho "uv $*"\nexit 0\n');
    fs.chmodSync(shim, 0o755);
    const r = spawnSync('node', ['checks/run.mjs', '--root', mdir, '--json'],
      { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bindir}${path.delimiter}${process.env.PATH}` } });
    const verdict = JSON.parse(r.stdout);
    const by = rowsById(verdict);
    check('matrix engine: pytest runs once per version as a single passing row', by.pytest?.status === 'pass', JSON.stringify(by.pytest));
    check('matrix engine: the row name reports the versions it covered', /3\.11.*3\.12/.test(by.pytest?.name || ''), by.pytest?.name);
  } finally {
    fs.rmSync(mdir, { recursive: true, force: true });
    fs.rmSync(bindir, { recursive: true, force: true });
  }
}

// — Package smoke: a built wheel must import. Pure resolution, then the engine
// end-to-end with a stubbed `uv` (build path) and the no-op paths. —
{
  const full = [
    '[build-system]',
    'requires = ["hatchling"]',
    '[project]',
    'name = "my-pkg"',
  ].join('\n');
  const parsed = parsePyproject(full);
  check('pyproject: detects a [build-system]', parsed.buildSystem === true);
  check('pyproject: extracts the distribution name', parsed.name === 'my-pkg');
  check('pyproject: no [build-system] ⇒ buildSystem false', parsePyproject('[project]\nname = "x"\n').buildSystem === false);

  const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pkg-'));
  try {
    fs.mkdirSync(path.join(sdir, 'src', 'my_pkg'), { recursive: true });
    fs.writeFileSync(path.join(sdir, 'src', 'my_pkg', '__init__.py'), '');
    check('importableModule: finds the src-layout package', importableModule(sdir) === 'my_pkg');
  } finally {
    fs.rmSync(sdir, { recursive: true, force: true });
  }
  // No package dir, but a name ⇒ normalized fallback; nothing at all ⇒ null.
  const ndir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pkg-name-'));
  try {
    fs.writeFileSync(path.join(ndir, 'pyproject.toml'), '[project]\nname = "My-Pkg.Name"\n');
    check('importableModule: falls back to the normalized dist name', importableModule(ndir) === 'my_pkg_name');
  } finally {
    fs.rmSync(ndir, { recursive: true, force: true });
  }

  // End-to-end with a stubbed uv: a buildable src-layout package ⇒ the smoke
  // invokes uv and passes; the report shows it ran.
  const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pkg-e2e-'));
  const bindir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pkg-bin-'));
  try {
    fs.writeFileSync(path.join(pdir, 'pyproject.toml'),
      '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n[project]\nname = "my-pkg"\n');
    fs.writeFileSync(path.join(pdir, 'uv.lock'), '');
    fs.mkdirSync(path.join(pdir, 'src', 'my_pkg'), { recursive: true });
    fs.writeFileSync(path.join(pdir, 'src', 'my_pkg', '__init__.py'), '');
    const shim = path.join(bindir, 'uv');
    fs.writeFileSync(shim, '#!/bin/sh\necho "uv $*"\nexit 0\n');
    fs.chmodSync(shim, 0o755);
    const r = spawnSync('node', ['checks/run.mjs', '--root', pdir, '--json'],
      { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bindir}${path.delimiter}${process.env.PATH}` } });
    const by = rowsById(JSON.parse(r.stdout));
    check('package-smoke: a buildable package runs and passes', by['package-smoke']?.status === 'pass', JSON.stringify(by['package-smoke']));
  } finally {
    fs.rmSync(pdir, { recursive: true, force: true });
    fs.rmSync(bindir, { recursive: true, force: true });
  }

  // No [build-system] ⇒ the smoke no-ops to pass without ever invoking uv (so it
  // can't false-fail). uv.lock present so the catalog entry is otherwise active.
  const nodir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pkg-noop-'));
  try {
    fs.writeFileSync(path.join(nodir, 'pyproject.toml'), '[project]\nname = "x"\n');
    fs.writeFileSync(path.join(nodir, 'uv.lock'), '');
    // a `uv` that always fails — proves the no-op path never calls it
    const bin2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-pkg-bin2-'));
    const shim = path.join(bin2, 'uv');
    fs.writeFileSync(shim, '#!/bin/sh\nexit 7\n');
    fs.chmodSync(shim, 0o755);
    const r = spawnSync('node', ['checks/run.mjs', '--root', nodir, '--json'],
      { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin2}${path.delimiter}${process.env.PATH}` } });
    const by = rowsById(JSON.parse(r.stdout));
    check('package-smoke: no [build-system] ⇒ no-op pass, uv never called', by['package-smoke']?.status === 'pass', JSON.stringify(by['package-smoke']));
    fs.rmSync(bin2, { recursive: true, force: true });
  } finally {
    fs.rmSync(nodir, { recursive: true, force: true });
  }
}

// — dispatch-dups & bats-assertions: the two source-scanning invariants. A dirty
// repo must FAIL each (duplicate dispatch arm / subparser id; an unchained bats
// assertion), a clean repo must PASS — and the dispatch-dups scan must ignore a
// parser id named only in a docstring (the false-RED to avoid). —
{
  const dirty = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-scan-dirty-'));
  try {
    // A __main__.py with a duplicate subparser id, a duplicate dispatch arm, and
    // a parser id that exists ONLY in a docstring (must not be flagged).
    fs.writeFileSync(path.join(dirty, '__main__.py'), [
      'import argparse',
      'def main():',
      '    """Usage: register a command with sub.add_parser("ghost")."""',
      '    p = argparse.ArgumentParser()',
      '    sub = p.add_subparsers(dest="command")',
      '    sub.add_parser("sync")',
      '    sub.add_parser("sync")',
      '    args = p.parse_args()',
      '    if args.command == "backfill":',
      '        return 1',
      '    elif args.command == "backfill":',
      '        return 2',
      ''].join('\n'));
    // A .bats file with an unchained earlier assertion (dead under bats).
    fs.writeFileSync(path.join(dirty, 'bad.bats'), [
      '@test "two unchained assertions" {',
      '  run echo hi',
      '  [ "$status" -eq 0 ]',
      '  [ "$output" = "hi" ]',
      '}',
      ''].join('\n'));
    const { verdict, code } = runJson(dirty);
    const by = rowsById(verdict);
    check('dispatch-dups fails on a dirty dispatch file', by['dispatch-dups']?.status === 'fail', JSON.stringify(by['dispatch-dups']));
    check('bats-assertions fails on an unchained assertion', by['bats-assertions']?.status === 'fail', JSON.stringify(by['bats-assertions']));
    check('a dirty scan makes the gate red', code === 1, `got ${code}`);
    check('both scan checks carry fix + rerun', Boolean(by['dispatch-dups']?.fix && by['dispatch-dups']?.rerun && by['bats-assertions']?.fix));

    // The detail isn't on the --json row (it rides the report), so assert the
    // scanners' detail directly — incl. that a parser id named ONLY in a
    // docstring is NOT flagged (the false-RED to avoid).
    const dd = dispatchDups.run({ root: dirty });
    check('dispatch-dups detail names the duplicate subparser id', dd.ok === false && /duplicate subparser id "sync"/.test(dd.detail), dd.detail);
    check('dispatch-dups detail names the duplicate dispatch arm', /duplicate dispatch arm `args\.command == "backfill"`/.test(dd.detail), dd.detail);
    check('dispatch-dups ignores a parser id only in a docstring', !/ghost/.test(dd.detail), dd.detail);
    const ba = batsAssertions.run({ root: dirty });
    check('bats-assertions detail names the unchained test', ba.ok === false && /unchained assertion/.test(ba.detail), ba.detail);
  } finally {
    fs.rmSync(dirty, { recursive: true, force: true });
  }

  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-scan-clean-'));
  try {
    fs.writeFileSync(path.join(clean, '__main__.py'), [
      'import argparse',
      'p = argparse.ArgumentParser()',
      'sub = p.add_subparsers(dest="command")',
      'sub.add_parser("sync")',
      'sub.add_parser("ship")',
      'args = p.parse_args()',
      'if args.command == "sync":',
      '    pass',
      'elif args.command == "ship":',
      '    pass',
      ''].join('\n'));
    fs.writeFileSync(path.join(clean, 'ok.bats'), [
      '@test "chained assertions" {',
      '  run echo hi',
      '  [ "$status" -eq 0 ] &&',
      '  [ "$output" = "hi" ]',
      '}',
      ''].join('\n'));
    const by = rowsById(runJson(clean).verdict);
    check('dispatch-dups passes a clean dispatch file', by['dispatch-dups']?.status === 'pass', JSON.stringify(by['dispatch-dups']));
    check('bats-assertions passes chained assertions', by['bats-assertions']?.status === 'pass', JSON.stringify(by['bats-assertions']));
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
  }

  // A repo with neither a dispatch file nor .bats: both scans skip fail-soft.
  const none = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-scan-none-'));
  try {
    fs.writeFileSync(path.join(none, 'README.md'), '# nothing to scan\n');
    const by = rowsById(runJson(none).verdict);
    check('dispatch-dups skips when there is no dispatch file', by['dispatch-dups']?.status === 'skip', by['dispatch-dups']?.status);
    check('bats-assertions skips when there are no .bats files', by['bats-assertions']?.status === 'skip', by['bats-assertions']?.status);
  } finally {
    fs.rmSync(none, { recursive: true, force: true });
  }
}

if (failures) {
  console.error(`\n${failures} engine self-test(s) failed`);
  process.exit(1);
}
console.log('\nchecks engine self-test passed');
