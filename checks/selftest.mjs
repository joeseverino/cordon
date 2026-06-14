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
  check('multi-phase run emits phase on every row', verdict.checks.every((c) => typeof c.phase === 'string'));
  check('post-build invariants run after build-output exists', by['internal-links']?.phase === 'post-build');

  // Close the loop: the emitter's real output must validate against the schema
  // the fixtures pin — the engine can't drift from its own contract.
  const verdictFile = path.join(dir, 'verdict.json');
  fs.writeFileSync(verdictFile, JSON.stringify(verdict));
  const conform = spawnSync('node', ['conformance/validate.mjs', verdictFile], { cwd: repo, encoding: 'utf8' });
  check('the live verdict validates against cordon-checks-v2', conform.status === 0, conform.stdout.trim() || conform.stderr.trim());

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

if (failures) {
  console.error(`\n${failures} engine self-test(s) failed`);
  process.exit(1);
}
console.log('\nchecks engine self-test passed');
