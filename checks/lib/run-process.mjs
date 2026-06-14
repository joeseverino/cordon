// Shared process harness for the checks engine's `command` entries — the
// subprocess sibling of an in-process invariant's `run(ctx)`. One spawn wrapper
// so every command entry gets the same guarantees: a per-command timeout (a hung
// `playwright test` fails the gate instead of wedging an unattended run forever),
// spawn failures (a missing binary) surface as a failed result rather than an
// unresolved promise, and output is either captured for the report or streamed
// live — never silently dropped.
//
// Graduated from jseverino.com/bin/lib/run.mjs (behavior preserved): that repo's
// gate runner and this engine were two copies of this exact wrapper. It lives
// here now so process-running has one definition the whole ecosystem references.
import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 5 * 60_000;

// Spawn `cmd args` and ALWAYS resolve (never reject) with:
//   { code, stdout, stderr, output, duration, timedOut }
// `code` is non-zero whenever the command failed for any reason — non-zero exit,
// signal kill, timeout, or failure to spawn at all — so a caller branches on one
// field. options: cwd, env (merged over process.env), timeout (ms; 0 disables),
// stdio: 'capture' (default) buffers stdout/stderr; 'inherit' streams to the
// terminal (and stdout/stderr come back empty). `output` is the ANSI-stripped
// combined stream, ready for a deterministic report.
export function runProcess(cmd, args, options = {}) {
  const { cwd, env, timeout = DEFAULT_TIMEOUT_MS, stdio = 'capture' } = options;

  return new Promise((resolve) => {
    const start = Date.now();
    const inherit = stdio === 'inherit';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: inherit ? 'inherit' : 'pipe',
    });

    const settle = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) stderr += `${stderr ? '\n' : ''}[timed out after ${Math.round(timeout / 1000)}s: ${cmd} ${args.join(' ')}]`;
      if (spawnError) stderr += `${stderr ? '\n' : ''}[failed to start: ${spawnError.message}]`;
      const finalCode = spawnError || timedOut ? (code || 1) : (code ?? 1);
      resolve({
        code: finalCode,
        stdout,
        stderr,
        output: stripAnsi(`${stdout}\n${stderr}`),
        duration: Date.now() - start,
        timedOut,
      });
    };

    const timer = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          // Escalate if the process ignores SIGTERM.
          setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000).unref();
        }, timeout)
      : null;

    if (!inherit) {
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    child.on('error', (error) => {
      spawnError = error;
      // 'close' never fires when the process could not spawn.
      setTimeout(() => settle(1), 0);
    });
    child.on('close', (code) => settle(code));
  });
}

export function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}
