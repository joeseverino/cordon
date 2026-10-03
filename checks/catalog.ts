// catalog.ts — cordon's built-in command catalog: the per-stack checks a repo
// gets for free, by detection. Where registry.ts holds the in-process,
// repo-agnostic *invariants*, this holds the spawned, stack-specific *commands*
// cordon ships centrally so a repo never re-declares them. Each entry is the
// exact shape a repo's cordon.checks.json `commands[]` uses — id, effect, exec,
// requires, fix — but sourced here and gated by its `requires` markers
// (file:/glob:/<binary>), so it lights up only where its stack is present. The
// engine runs a catalog entry through the same `command` path as a repo's own.
//
// The whole point: a uv repo gets ruff+pytest+package-smoke, a cordon-tool repo
// gets conformance+drift, a shell repo gets shellcheck+bats — with NO per-repo
// file. A repo turns one off by id (`disable: ["ruff"]`) or forces a default-off
// one on (`enable: [...]`). Effect/exec/fix never appear at repo level. The
// catalog is scoped to tool/CLI/MCP repos (Python packages, cordon tools, shell
// toolchains), not websites or web apps.
//
// Adding a stack = adding entries here. Nothing else. An entry's `default: 'off'`
// makes it opt-in (heavy or destructive-adjacent suites); absent ⇒ on when its
// markers are present.
//
// An entry may also carry an optional `expand({ root, config })` seam: a function
// that returns an array of `{ label, args }` variants to run in place of the
// static `exec.args` — one check, run N times, passing only if every variant
// does (the report names which variant failed). It's how `pytest` runs across a
// repo's declared Python versions as a single check, without a CI matrix. Return
// `null`/`[]` to fall back to the one static run.
import { readPyproject } from './lib/pyproject.ts';
import { cordonAsset, cordonScript } from '../lib/root.ts';
import type { CheckConfig, JsonSchema } from './lib/types.ts';

// The command-spec shape shared by the catalog, discovered scripts, and a repo's
// cordon.checks.json `commands[]`.
export interface ExecSpec { cmd: string; args?: string[]; env?: Record<string, string> }
export interface Variant { label: string; args: string[] }
export interface CommandSpec {
  id: string;
  name?: string;
  effect: string;
  exec: ExecSpec;
  fixExec?: ExecSpec;
  requires?: string[];
  phase?: string;
  network?: boolean;
  interactive?: boolean;
  default?: string;
  timeout?: number;
  fix?: string;
  configSchema?: JsonSchema;
  expand?: (ctx: { root: string; config: CheckConfig }) => Variant[] | null;
}

// cordon owns its own validator and helper scripts, so catalog entries resolve
// them from cordon's root — no $CORDON_HOME, no vendoring — as the same kind of
// file as the running engine (source .ts, or built .js under dist/).
const VALIDATE = cordonScript('conformance/validate');
const SHELLCHECK_SH = cordonAsset('checks', 'lib', 'shellcheck-repo.sh');
const VERSION_ALIGN = cordonScript('checks/lib/version-align');
const PACKAGE_SMOKE = cordonScript('checks/lib/package-smoke');

export const CATALOG: CommandSpec[] = [
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
    exec: { cmd: 'uv', args: ['run', 'ruff', 'check'] },
    fix: 'Run `uv run ruff check --fix`, or fix the reported lines.',
    // The autofix seam: --fix runs ruff's own fixer, then re-runs the lint to
    // prove it (rules with no autofix still fail and need a human).
    fixExec: { cmd: 'uv', args: ['run', 'ruff', 'check', '--fix'] },
  },
  {
    id: 'pytest', name: 'Pytest', effect: 'read',
    requires: ['file:pyproject.toml', 'file:uv.lock', 'uv'],
    exec: { cmd: 'uv', args: ['run', 'pytest', '-q'] },
    fix: 'Run `uv run pytest -q` and fix the failing test.',
    // Multi-version coverage with no CI matrix and no per-repo workflow: run the
    // suite once per Python version the package supports, in one check. Versions
    // come from `[project].classifiers` (auto-on from what's already declared);
    // `pythonVersions` in cordon.checks.json overrides them, and `[]` opts out
    // back to a single default run. The `dev` extra is added when the package
    // ships one, so each version's env has the test deps (the gate's
    // `uv sync --extra dev` convention, applied per version). No classifiers ⇒
    // null ⇒ the single `uv run pytest -q` above. Runs locally too, not just CI.
    expand: ({ root, config }) => {
      const declared = readPyproject(root);
      const versions: string[] = Array.isArray(config.pythonVersions) ? config.pythonVersions : declared.versions;
      if (!versions || versions.length === 0) return null;
      const extras: string[] = declared.extras;
      const extra = extras.includes('dev') ? ['--extra', 'dev'] : [];
      return versions.map((v) => ({ label: v, args: ['run', '--python', v, ...extra, 'pytest', '-q'] }));
    },
    configSchema: {
      type: 'object',
      additionalProperties: false,
      description: 'Config for the Pytest check.',
      properties: {
        pythonVersions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Python versions to run the suite across (e.g. ["3.11","3.12"]), as one check via `uv run --python <v>`. Omit to auto-derive from pyproject [project].classifiers; set [] to force a single default run.',
        },
      },
    },
  },
  // pyproject [project].version must match the package __version__. A general
  // Python rule (cordon reads both files), so it graduates here instead of a
  // hand-written version_check command in each repo. No-ops where there's
  // nothing to align (dynamic version, no module __version__).
  {
    id: 'version-alignment', name: 'Version alignment', effect: 'read',
    requires: ['file:pyproject.toml', 'node'],
    exec: { cmd: 'node', args: [VERSION_ALIGN] },
    fix: 'Align pyproject [project].version with the package __version__ (e.g. src/<pkg>/__init__.py).',
    // The autofix seam: pyproject is canonical (release-please bumps it), so
    // --fix rewrites the module __version__ to match — deterministic direction.
    fixExec: { cmd: 'node', args: [VERSION_ALIGN, '--fix'] },
  },
  // Build the wheel and import it from an isolated env — catches "imports from
  // source, broken once installed" (a module missing from the wheel, a bad build
  // backend) that the source-tree pytest never sees. No-ops where there's no
  // [build-system] or no determinable module, so it only fails on a real
  // packaging error. Replaces a per-repo "smoke test the installed package" CI
  // step with one auto-detected check. (requires uv.lock too, so it lights up
  // only in a real uv package, not any stray pyproject.)
  {
    id: 'package-smoke', name: 'Built package imports', effect: 'read',
    requires: ['file:pyproject.toml', 'file:uv.lock', 'uv', 'node'],
    exec: { cmd: 'node', args: [PACKAGE_SMOKE] },
    fix: 'The built wheel failed to import. Check the build backend config and that the package modules ship in the wheel (e.g. [tool.hatch.build]/packages, MANIFEST), then `uv run --no-project --with . python -c "import <pkg>"`.',
  },

  // ── Cordon tool repo ─ a contract/ dir of golden --describe output ──────────
  {
    id: 'conformance', name: 'Contracts validate against cordon', effect: 'read',
    requires: ['file:contract', 'node'],
    exec: { cmd: 'sh', args: ['-c', `for f in contract/*.json; do node "${VALIDATE}" "$f" || exit 1; done`] },
    fix: 'Regenerate the golden after a surface change: `bin/<tool> --describe > contract/<tool>.json`.',
  },
  {
    id: 'drift', name: 'Contract matches live --describe', effect: 'read',
    requires: ['file:contract', 'glob:bin/*', '!ci'],
    exec: { cmd: 'sh', args: ['-c', 'for t in bin/*; do [ -x "$t" ] || continue; g="contract/$(basename "$t").json"; "$t" --describe | diff -u "$g" - || exit 1; done'] },
    fix: 'Regenerate the golden after a surface change: `bin/<tool> --describe > contract/<tool>.json`. (Local-only — needs the tools on PATH.)',
  },
  // The README's generated reference block must be in sync. A convention — a repo
  // ships scripts/gen-readme.mjs and this asserts `--check` is clean — so it
  // graduates here, gated on that script's presence, instead of being declared
  // per repo.
  {
    id: 'readme-sync', name: 'README reference in sync', effect: 'read',
    requires: ['file:scripts/gen-readme.mjs', 'node'],
    exec: { cmd: 'node', args: ['scripts/gen-readme.mjs', '--check'] },
    fix: 'Run `node scripts/gen-readme.mjs` to regenerate the README reference block.',
  },

  // ── Shell ─ tracked shell scripts + bats suite ──────────────────────────────
  {
    id: 'shellcheck', name: 'ShellCheck', effect: 'read',
    requires: ['glob:**/*.sh', 'shellcheck'],
    exec: { cmd: 'sh', args: [SHELLCHECK_SH] },
    fix: 'Fix the reported shell issues, or add a scoped `# shellcheck disable=...`.',
  },
  // The shell-repo sibling of pytest: a tests/ tree of *.bats runs through bats,
  // auto-detected so a shell toolchain needs no per-repo file. Good bats suites
  // self-resolve their own paths (BATS_TEST_DIRNAME), so no env is required.
  {
    id: 'bats', name: 'Bats tests', effect: 'read',
    requires: ['glob:tests/**/*.bats', 'bats'],
    exec: { cmd: 'bats', args: ['tests'] },
    fix: 'Run `bats tests` and fix the failing test.',
  },
];
