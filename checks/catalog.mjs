// catalog.mjs — cordon's built-in command catalog: the per-stack checks a repo
// gets for free, by detection. Where registry.mjs holds the in-process,
// repo-agnostic *invariants*, this holds the spawned, stack-specific *commands*
// cordon ships centrally so a repo never re-declares them. Each entry is the
// exact shape a repo's cordon.checks.json `commands[]` uses — id, effect, exec,
// requires, fix — but sourced here and gated by its `requires` markers
// (file:/glob:/<binary>), so it lights up only where its stack is present. The
// engine runs a catalog entry through the same `command` path as a repo's own.
//
// The whole point: a uv repo gets ruff+pytest+pip-audit, a cordon-tool repo gets
// conformance+drift, a shell repo gets shellcheck — with NO per-repo file. A
// repo turns one off by id (`disable: ["pip-audit"]`) or forces a default-off
// one on (`enable: ["playwright"]`). Effect/exec/fix never appear at repo level.
//
// Adding a stack = adding entries here. Nothing else. An entry's `default: 'off'`
// makes it opt-in (heavy or destructive-adjacent suites); absent ⇒ on when its
// markers are present.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// cordon owns its own validator, so the `conformance` check resolves it from
// here — no $CORDON_HOME, no vendoring. checks/ is one level under the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url)); // checks/
const CORDON_ROOT = path.resolve(HERE, '..');
const VALIDATE = path.join(CORDON_ROOT, 'conformance', 'validate.mjs');
const SHELLCHECK_SH = path.join(HERE, 'lib', 'shellcheck-repo.sh');

export const CATALOG = [
  // ── Python (uv) ─ pyproject.toml + uv.lock present, run through uv ──────────
  // The fast, deterministic local-gate pair. Dependency auditing (pip-audit) is
  // deliberately NOT here: a supply-chain scan's value is the *scheduled* run that
  // catches a newly-disclosed CVE in an unchanged lockfile, which a change-driven
  // local/PR gate can't do. That belongs in a dedicated workflow (the official
  // pypa/gh-action-pip-audit on a weekly cron), where the advisory ignores live
  // next to the audit — not duplicated as a check here.
  {
    id: 'ruff', name: 'Ruff lint', effect: 'read',
    requires: ['file:pyproject.toml', 'file:uv.lock', 'uv'],
    exec: { cmd: 'uv', args: ['run', 'ruff', 'check', 'src', 'tests'] },
    fix: 'Run `uv run ruff check --fix src tests`, or fix the reported lines.',
  },
  {
    id: 'pytest', name: 'Pytest', effect: 'read',
    requires: ['file:pyproject.toml', 'file:uv.lock', 'uv'],
    exec: { cmd: 'uv', args: ['run', 'pytest', '-q'] },
    fix: 'Run `uv run pytest -q` and fix the failing test.',
  },

  // ── Django ─ manage.py present ──────────────────────────────────────────────
  {
    id: 'django-check', name: 'Django system check', effect: 'read',
    requires: ['file:manage.py', 'python3'],
    exec: { cmd: 'python3', args: ['manage.py', 'check'] },
    fix: 'Resolve the issues `manage.py check` reports (app config, models, settings).',
  },
  {
    id: 'django-migrations', name: 'Migrations match models', effect: 'read',
    requires: ['file:manage.py', 'python3'],
    exec: { cmd: 'python3', args: ['manage.py', 'makemigrations', '--check', '--dry-run'] },
    fix: 'Run `python3 manage.py makemigrations` and commit the generated migration.',
  },

  // ── Cordon tool repo ─ a contract/ dir of golden --describe output ──────────
  {
    id: 'conformance', name: 'Contracts validate against cordon', effect: 'read',
    requires: ['file:contract', 'node'],
    exec: { cmd: 'sh', args: ['-c', `for f in contract/*.json; do node "${VALIDATE}" "$f" || exit 1; done`] },
    fix: 'Regenerate the golden after a surface change: `bin/<tool> --describe > contract/<tool>.json`.',
  },
  {
    id: 'drift', name: 'Contract == live --describe', effect: 'read',
    requires: ['file:contract', 'glob:bin/*', '!ci'],
    exec: { cmd: 'sh', args: ['-c', 'for t in bin/*; do [ -x "$t" ] || continue; g="contract/$(basename "$t").json"; "$t" --describe | diff -u "$g" - || exit 1; done'] },
    fix: 'Regenerate the golden after a surface change: `bin/<tool> --describe > contract/<tool>.json`. (Local-only — needs the tools on PATH.)',
  },

  // ── Shell ─ any tracked shell script ────────────────────────────────────────
  {
    id: 'shellcheck', name: 'ShellCheck', effect: 'read',
    requires: ['glob:**/*.sh', 'shellcheck'],
    exec: { cmd: 'sh', args: [SHELLCHECK_SH] },
    fix: 'Fix the reported shell issues, or add a scoped `# shellcheck disable=...`.',
  },

  // ── Node web ─ config-file detected; the heavy e2e suite is opt-in ──────────
  {
    id: 'stylelint', name: 'Stylelint', effect: 'read',
    requires: ['glob:stylelint.config.*', 'stylelint'],
    exec: { cmd: 'sh', args: ['-c', 'stylelint "src/**/*.css"'] },
    fix: 'Run `stylelint --fix "src/**/*.css"`, or fix the reported rules.',
  },
  {
    id: 'playwright', name: 'Playwright e2e', effect: 'read', network: true, default: 'off',
    requires: ['glob:playwright.config.*', 'playwright'],
    exec: { cmd: 'playwright', args: ['test'] },
    fix: 'Run `playwright test`; fix the failing spec, or update snapshots if the change is intended.',
  },
];
