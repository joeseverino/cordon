import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, test } from 'node:test';
import { CORDON_ROOT, cordonAsset, cordonScript } from '../lib/root.ts';

const VALIDATE = cordonScript('conformance/validate');
const leaf = fs.readFileSync(cordonAsset('fixtures', 'valid', 'leaf-tool.json'), 'utf8');

function runValidate(args: string[], chunks: { data: string; delayMs: number }[] | null = null) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [VALIDATE, ...args], { cwd: CORDON_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    void (async () => {
      for (const chunk of chunks ?? []) {
        await new Promise((r) => setTimeout(r, chunk.delayMs));
        child.stdin.write(chunk.data);
      }
      child.stdin.end();
    })();
  });
}

describe('conformance validator', () => {
  test('the fixture suite passes', () => {
    const r = spawnSync(process.execPath, [VALIDATE], { cwd: CORDON_ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all fixtures conform/);
  });

  test('a single document validates from a file', () => {
    const r = spawnSync(process.execPath, [VALIDATE, cordonAsset('fixtures', 'valid', 'leaf-tool.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /is a valid Cordon contract/);
  });

  test('an invalid document exits 1 with its errors', () => {
    const r = spawnSync(process.execPath, [VALIDATE, cordonAsset('fixtures', 'invalid', 'bad-effect.json')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not a valid Cordon contract/);
  });

  test('stdin: a document written in slow chunks validates', async () => {
    const mid = Math.floor(leaf.length / 2);
    const r = await runValidate(['-'], [
      { data: leaf.slice(0, mid), delayMs: 100 },
      { data: leaf.slice(mid), delayMs: 400 },
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /is a valid Cordon contract/);
  });

  test('stdin: a large document validates', async () => {
    const big = JSON.stringify({ ...JSON.parse(leaf), paras: ['x'.repeat(300_000)] });
    const r = await runValidate(['-'], [{ data: big, delayMs: 0 }]);
    assert.equal(r.code, 0, r.stderr);
  });

  test('stdin: an empty stream fails as invalid JSON, not a hang', async () => {
    const r = await runValidate(['-'], []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /SyntaxError/);
  });

  test('stdin: a document that is neither contract exits 1', async () => {
    const r = await runValidate(['-'], [{ data: '{"a":1}', delayMs: 0 }]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /neither a Cordon contract nor a checks verdict/);
  });

  test('an unknown flag exits 2 with a message', () => {
    const r = spawnSync(process.execPath, [VALIDATE, '--bogus'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown option '--bogus'/);
  });

  test('more than one file exits 2', () => {
    const r = spawnSync(process.execPath, [VALIDATE, 'a.json', 'b.json'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });

  test('a file path outside the repo validates (cwd independent)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cordon-validate-'));
    try {
      const file = path.join(dir, 'doc.json');
      fs.writeFileSync(file, leaf);
      const r = spawnSync(process.execPath, [VALIDATE, file], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
