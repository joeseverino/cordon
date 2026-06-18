// Self-test for the harness verdict logic. No deps; exits non-zero on failure.
import { EFFECTS, PRESETS, verdict, resolveEffect } from './policy.mjs';

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures += 1;
  }
}

// The ladder is sourced from the schema, lowest to highest blast radius.
check(EFFECTS[0] === 'read' && EFFECTS.at(-1) === 'deploy', 'ladder runs read..deploy');

// local: reads and writes pass, remote/deploy confirm, missing effect fails open.
check(verdict('read', PRESETS.local).decision === 'allow', 'local read → allow');
check(verdict('vault_write', PRESETS.local).decision === 'allow', 'local vault_write → allow');
check(verdict('deploy', PRESETS.local).decision === 'confirm', 'local deploy → confirm');
check(verdict(null, PRESETS.local).decision === 'allow', 'local missing effect fails open');

// strict: writes confirm, remote/deploy block, missing effect fails closed.
check(verdict('local_write', PRESETS.strict).decision === 'confirm', 'strict local_write → confirm');
check(verdict('deploy', PRESETS.strict).decision === 'block', 'strict deploy → block');
check(verdict(null, PRESETS.strict).decision === 'block', 'strict missing effect fails closed');

// the verdict reports its reasoning and whether the effect was declared.
const v = verdict('remote_write', PRESETS.local);
check(v.declared === true && v.decision === 'confirm', 'verdict carries declared + decision');
check(verdict(null).declared === false, 'undeclared verdict marks declared false');

// an off-ladder effect is a hard error, not a silent pass.
let threw = false;
try {
  verdict('nuke');
} catch {
  threw = true;
}
check(threw, 'off-ladder effect rejected');

// resolveEffect picks a command's effect, falls back to the tool effect, and
// returns undefined for an unknown command (which then hits the preset default).
const contract = { effect: 'read', commands: [{ name: 'ship', effect: 'deploy' }] };
check(resolveEffect(contract, 'ship') === 'deploy', 'resolve command effect');
check(resolveEffect(contract, null) === 'read', 'resolve tool-level effect');
check(resolveEffect(contract, 'missing') === undefined, 'unknown command → undefined');

if (failures) {
  console.error(`harness selftest: ${failures} failed`);
  process.exit(1);
}
console.log('harness selftest: verdict + resolution invariants pass');
