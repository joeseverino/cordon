// idempotence — a portable invariant graduated from jseverino.com's diagnose
// harness: running a repo's own build/verification step must leave the worktree
// byte-identical. A step that dirties tracked or untracked files on every run is
// a latent CI failure and a trap for an agent that builds before it commits.
//
// The rule is universal; the *command* is the local seam. With no command
// configured this check skips (fail-soft), so it runs unmodified in any repo:
//   cordon.checks.json -> { "idempotence": { "command": "npm run build" } }
//
// Unlike repository-policy (a pure `read`), this check *runs* the configured
// command, so it declares `effect: local_write` — the verdict tells an agent the
// cost of producing it, which is exactly what goldmine-2's effect-on-checks is
// for: never silently run a build behind a "checks" call that looked read-only.
import { spawnSync } from 'node:child_process';
import { defaultsOf } from './config.mjs';
import { isGitRepo, worktreeStatus } from './git.mjs';

// The check's config seam, declared once as JSON Schema and carried on the
// default export. config-schema.mjs composes it into the editor/AI-facing
// `cordon.checks.json` schema; the runtime DEFAULTS below are derived from the
// same source, so the documented default and the actual default are one value.
const configSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Run a build/verify command and assert it leaves the worktree byte-identical. Off until you set a command.',
  properties: {
    command: {
      type: ['string', 'null'],
      default: null,
      description: 'Shell command whose run must not change tracked or untracked files, e.g. "npm run build". null skips the check — set this to turn it on.',
    },
    timeoutMs: {
      type: 'integer',
      minimum: 1,
      default: 600000,
      description: 'Kill the command after this many milliseconds rather than wedge the gate.',
    },
  },
};

const DEFAULTS = defaultsOf(configSchema);

export default {
  id: 'idempotence',
  name: 'Worktree Idempotence',
  effect: 'local_write',
  gates: ['check'],
  configSchema,
  fix: 'A configured command mutated the worktree. Commit the generated output, '
    + 'add it to .gitignore, or make the step deterministic so re-running leaves '
    + 'the tree byte-identical. The detail shows what changed.',

  run({ root, config = {} }) {
    const cfg = { ...DEFAULTS, ...config };
    if (!cfg.command) {
      return { skipped: true, detail: 'no idempotence command configured (set { "idempotence": { "command": "…" } } in cordon.checks.json)' };
    }
    if (!isGitRepo(root)) return { skipped: true, detail: 'not a git work tree — cannot diff worktree state' };

    // Compare against the state *before* the run, so a pre-existing dirty tree
    // is fine — we only flag mutation the command itself introduces.
    const before = worktreeStatus(root);
    const r = spawnSync(cfg.command, [], { cwd: root, encoding: 'utf8', shell: true, timeout: cfg.timeoutMs });
    if (r.status !== 0) {
      const out = (r.stderr || r.stdout || '').trim();
      return { ok: false, detail: `command \`${cfg.command}\` exited ${r.status ?? '(signal ' + r.signal + ')'}\n${out}` };
    }
    const after = worktreeStatus(root);
    if (before !== after) {
      return {
        ok: false,
        detail: `\`${cfg.command}\` mutated the worktree:\nbefore:\n${before.trim() || '(clean)'}\nafter:\n${after.trim() || '(clean)'}`,
      };
    }
    return { ok: true, detail: `\`${cfg.command}\` left the worktree byte-identical` };
  },
};
