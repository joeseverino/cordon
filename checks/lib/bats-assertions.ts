// bats-assertions — a portable invariant catching the bats statements whose
// failure is silently ignored when they are not a @test's last statement. bats
// runs a test body under `set -e`, so a failing non-final `[ ]` or plain command
// does fail the test; these three shapes do not:
//   • `[[ ... ]]` — bash < 4.1 (macOS /bin/bash 3.2) never trips errexit on it;
//   • `! cmd`     — a negated pipeline never trips errexit, on any bash;
//   • `A && B`    — a failing element before the last `&&` never trips errexit.
// A `|| return 1` (or `|| false`) tail makes any of them binding, `run ! cmd`
// replaces `! cmd`, and the final statement always sets the test's status.
// Read-only, runs wherever .bats files exist, no config.
import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './git.ts';
import type { Check } from './types.ts';

interface Statement { text: string; line: number }
interface TestBlock { name: string; body: Statement[] }
type Quote = '' | "'" | '"';

const TEST_OPEN = /^\s*@test\b.*\{\s*$/;
const TEST_CLOSE = /^\}\s*$/;
const CONTINUES = /(&&|\|\||\||\\)$/;
const HEREDOC = /(?:^|[^<])<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/;

// One physical line, scanned from the quote state the previous line left open:
// the code with any `#` comment removed (only a `#` that starts a word outside
// quotes, so `${#arr[@]}` and `"a #b"` survive) and the quote state at its end.
function scanLine(line: string, quote: Quote): { code: string; quote: Quote } {
  let q = quote;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = '';
    } else if (q === '"') {
      if (c === '\\') i += 1;
      else if (c === '"') q = '';
    } else if (c === '\\') {
      i += 1;
    } else if (c === "'" || c === '"') {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      return { code: line.slice(0, i), quote: q };
    }
  }
  return { code: line, quote: q };
}

// The body lines of each `@test ... {` up to its closing `}` (alone on a line,
// as bats suites are written), folded into logical statements: lines ending in
// `&&`, `||`, `|` or `\`, or inside an open quote, join the next; heredoc
// bodies are skipped; blanks and comments drop out.
function testBlocks(src: string): TestBlock[] {
  const lines = src.split('\n');
  const blocks: TestBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i] ?? '';
    if (!TEST_OPEN.test(open)) continue;
    const name = open.match(/@test\s+(['"])(.*?)\1/)?.[2] ?? open.trim();
    const body: Statement[] = [];
    let quote: Quote = '';
    let pending = null as Statement | null;
    let heredoc: { delim: string; strip: boolean } | null = null;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const raw = lines[j] ?? '';
      if (heredoc) {
        if ((heredoc.strip ? raw.replace(/^\t+/, '') : raw) === heredoc.delim) heredoc = null;
        continue;
      }
      if (!quote && !pending && TEST_CLOSE.test(raw)) break;
      const wasQuoted = quote !== '';
      const scanned = scanLine(raw, quote);
      quote = scanned.quote;
      const code = scanned.code.trim();
      if (!pending && !code) continue;
      if (!wasQuoted) {
        const doc = code.match(HEREDOC);
        if (doc?.[3]) heredoc = { delim: doc[3], strip: doc[1] === '-' };
      }
      if (pending) pending.text = `${pending.text} ${code}`.trim();
      else pending = { text: code, line: j + 1 };
      if (quote) continue;
      if (CONTINUES.test(pending.text)) {
        if (pending.text.endsWith('\\')) pending.text = pending.text.slice(0, -1).trimEnd();
        continue;
      }
      body.push(pending);
      pending = null;
    }
    if (pending) body.push(pending);
    blocks.push({ name, body });
    i = j;
  }
  return blocks;
}

// The `&&` / `||` operators of a statement's top-level list — outside quotes,
// `$( )`/`( )`, `${ }`, and `[[ ]]` (where `&&` is a test operator, not a list).
function topLevelOps(text: string): { op: '&&' | '||'; at: number }[] {
  const ops: { op: '&&' | '||'; at: number }[] = [];
  let quote: Quote = '';
  let paren = 0;
  let brace = 0;
  let test = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const prev = text[i - 1] ?? ' ';
    const next = text[i + 1] ?? '';
    if (quote === "'") { if (c === "'") quote = ''; continue; }
    if (quote === '"') {
      if (c === '\\') i += 1;
      else if (c === '"') quote = '';
      continue;
    }
    if (c === '\\') { i += 1; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') { paren += 1; continue; }
    if (c === ')') { paren = Math.max(0, paren - 1); continue; }
    if (c === '$' && next === '{') { brace += 1; i += 1; continue; }
    if (c === '}' && brace > 0) { brace -= 1; continue; }
    if (c === '[' && next === '[' && /[\s!(]/.test(prev) && /\s/.test(text[i + 2] ?? '')) { test += 1; i += 1; continue; }
    if (c === ']' && next === ']' && test > 0 && /\s/.test(prev)) { test -= 1; i += 1; continue; }
    if (paren || brace || test) continue;
    if ((c === '&' || c === '|') && next === c) {
      ops.push({ op: c === '&' ? '&&' : '||', at: i });
      i += 1;
    }
  }
  return ops;
}

// A plain `run cmd` always returns 0, so it can never be the ignored element of
// an `A && B` list; `run !` and `run -N` can fail and so count.
const cannotFail = (part: string) => /^run\s/.test(part) && !/^run\s+(!|-)/.test(part);

// Why a non-final statement's failure would be ignored, or null when it binds.
function ignoredReason(text: string): string | null {
  const ops = topLevelOps(text);
  const last = ops[ops.length - 1];
  const tail = last?.op === '||' ? text.slice(last.at + 2).trim() : '';
  // A `|| return 1` / `|| false` tail turns any of the shapes below binding.
  if (tail && !/^(\[\[|!)\s/.test(tail)) return null;
  if (/^!\s/.test(text)) return '`! cmd` never trips errexit';
  if (/^\[\[\s/.test(text)) return '`[[ ]]` never trips errexit on bash < 4.1';
  const ands = ops.filter((o) => o.op === '&&');
  const lastAnd = ands[ands.length - 1];
  // `cond && continue` / `cond && break` is loop control flow, not an assertion.
  if (lastAnd && !/^(continue|break)(\s+\d+)?;?$/.test(text.slice(lastAnd.at + 2).trim())) {
    const heads = text.slice(0, lastAnd.at).split(/&&|\|\|/).map((p) => p.trim());
    if (!heads.every(cannotFail)) return 'a failing element before the last `&&` never trips errexit';
  }
  return null;
}

function ignoredStatements(block: TestBlock): { line: number; reason: string }[] {
  // The final statement sets the test's status, so it is always exempt.
  return block.body.slice(0, -1).flatMap((s) => {
    const reason = ignoredReason(s.text);
    return reason ? [{ line: s.line, reason }] : [];
  });
}

export default {
  id: 'bats-assertions',
  name: 'Bats Assertion Chaining',
  effect: 'read',
  gates: ['check'],
  fix: 'Split `A && B` onto separate lines, write `[ ]` or append `|| return 1` to '
    + '`[[ ]]` and `! cmd`, or use `run ! cmd`.',

  run({ root }) {
    const files = listFiles(root, ['.bats']);
    if (files.length === 0) return { skipped: true, detail: 'no .bats files' };
    const failures: string[] = [];
    let tests = 0;
    for (const rel of files) {
      let src;
      try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
      for (const block of testBlocks(src)) {
        tests += 1;
        for (const { line, reason } of ignoredStatements(block)) {
          failures.push(`${rel}:${line}: test "${block.name}" — ${reason}`);
        }
      }
    }
    return failures.length
      ? { ok: false, detail: failures.map((m) => `- ${m}`).join('\n') }
      : { ok: true, detail: `${tests} bats test(s) clean: no non-final statement whose failure bats would ignore` };
  },
} satisfies Check;
