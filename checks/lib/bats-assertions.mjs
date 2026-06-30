// bats-assertions — a portable invariant catching the bats foot-gun where only a
// @test's LAST command sets its status, so an earlier unchained `[ ]`/`[[ ]]`
// assertion is silently ignored: a real failure passes locally and only CI's bats
// catches it. Flags any test carrying 2+ bracket assertions where a non-final one
// isn't joined forward with `&&` (or `||`). Read-only, runs wherever .bats files
// exist, no config.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './repo-files.mjs';

const TEST_OPEN = /^\s*@test\b.*\{\s*$/;
const ASSERTION = /^\[\[?[\s(]/;        // a line beginning a `[ ... ]` / `[[ ... ]]` test
const CONNECTOR = /(&&|\|\||\\)\s*$/;   // joined forward to the next statement

// Split a .bats source into { name, startLine, body[] } test blocks. Bodies are
// the statement lines between the `@test ... {` and its matching `}`, with `#`
// comments and blanks dropped (line numbers preserved on each kept line).
function testBlocks(src) {
  const lines = src.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!TEST_OPEN.test(lines[i])) continue;
    const name = (lines[i].match(/@test\s+(['"])(.*?)\1/) || [, , lines[i].trim()])[2];
    const body = [];
    let depth = 1;
    let j = i + 1;
    for (; j < lines.length && depth > 0; j += 1) {
      const raw = lines[j];
      depth += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length;
      if (depth <= 0) break;
      const code = raw.replace(/#.*$/, '').trim();
      if (code) body.push({ text: code, line: j + 1 });
    }
    blocks.push({ name, startLine: i + 1, body });
    i = j;
  }
  return blocks;
}

function unchainedAssertions(block) {
  const assertions = block.body.filter((s) => ASSERTION.test(s.text));
  if (assertions.length < 2) return [];
  const lastCmd = block.body[block.body.length - 1];
  // A non-final bracket assertion that doesn't hand its result forward (&&/||) is
  // dead: bats only honors the test's last command.
  return assertions
    .filter((s) => s !== lastCmd && !CONNECTOR.test(s.text))
    .map((s) => s.line);
}

export default {
  id: 'bats-assertions',
  name: 'Bats Assertion Chaining',
  effect: 'read',
  gates: ['check'],
  fix: 'Join the earlier `[ ]`/`[[ ]]` assertions with `&&` (or split them into '
    + 'separate @test cases) so every assertion sets the test status — bats only '
    + 'honors a test\'s last command. The detail lists each test and the dead lines.',

  run({ root }) {
    const files = listFiles(root, ['.bats']);
    if (files.length === 0) return { skipped: true, detail: 'no .bats files' };
    const failures = [];
    let tests = 0;
    for (const rel of files) {
      let src;
      try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
      for (const block of testBlocks(src)) {
        tests += 1;
        const dead = unchainedAssertions(block);
        if (dead.length) {
          failures.push(`${rel}: test "${block.name}" — unchained assertion(s) at line ${dead.join(', ')} (only the test's last command sets status)`);
        }
      }
    }
    return failures.length
      ? { ok: false, detail: failures.map((m) => `- ${m}`).join('\n') }
      : { ok: true, detail: `${tests} bats test(s) clean: every multi-assertion test chains with &&` };
  },
};
