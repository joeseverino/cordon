import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFECTS, PRESETS, verdict, resolveEffect } from './policy.ts';

test('the ladder is sourced from the schema, lowest to highest blast radius', () => {
  assert.equal(EFFECTS[0], 'read');
  assert.equal(EFFECTS.at(-1), 'deploy');
});

test('local: reads and writes pass, remote and deploy confirm, a missing effect fails open', () => {
  assert.equal(verdict('read', PRESETS.local).decision, 'allow');
  assert.equal(verdict('vault_write', PRESETS.local).decision, 'allow');
  assert.equal(verdict('deploy', PRESETS.local).decision, 'confirm');
  assert.equal(verdict(null, PRESETS.local).decision, 'allow');
});

test('strict: writes confirm, remote and deploy block, a missing effect fails closed', () => {
  assert.equal(verdict('local_write', PRESETS.strict).decision, 'confirm');
  assert.equal(verdict('deploy', PRESETS.strict).decision, 'block');
  assert.equal(verdict(null, PRESETS.strict).decision, 'block');
});

test('a verdict reports its reasoning and whether the effect was declared', () => {
  const v = verdict('remote_write', PRESETS.local);
  assert.ok(v.declared && v.decision === 'confirm', 'verdict carries declared + decision');
  assert.equal(verdict(null).declared, false);
});

test('an off-ladder effect is a hard error, not a silent pass', () => {
  assert.throws(() => verdict('nuke'));
});

test('resolveEffect picks a command effect, then the tool effect, else undefined', () => {
  const contract = { effect: 'read', commands: [{ name: 'ship', effect: 'deploy' }] };
  assert.equal(resolveEffect(contract, 'ship'), 'deploy');
  assert.equal(resolveEffect(contract, null), 'read');
  assert.equal(resolveEffect(contract, 'missing'), undefined);
});
