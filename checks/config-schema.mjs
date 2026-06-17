// Composes the JSON Schema for a repo's `cordon.checks.json` from the registry —
// the editor/AI-facing analog of a command's `--describe`. Each check owns its
// config contract (`configSchema`); this folds them into one document keyed by
// check id, so completeness is structural: register a check with a configSchema
// and it appears here (and in every editor pointed at the published file) with
// no second edit. `checks/run.mjs --schema` is the reference emitter; the
// committed `checks/config.schema.json` is the published artifact the `$schema`
// URL serves, kept fresh by cordon's own dogfooded idempotence check.
import { CHECKS } from './registry.mjs';
import { CATALOG } from './catalog.mjs';

// The stable home the published schema is served from — what a consuming repo's
// `cordon.checks.json` points its `$schema` at for editor autocomplete + AI. A
// canonical `$id` on the `https://jseverino.com/schemas/…` convention, distinct
// from the verdict schema (cordon-checks-v2.json): this describes the *config*
// file you write, that describes the *verdict* the engine emits. One address,
// version-stable, not a floating branch ref.
export const SCHEMA_ID = 'https://jseverino.com/schemas/cordon-checks-config-v2.json';

// The two engine-level keys (not per-check): where the build emits, and the
// repo's own spawned specs. Declared here so cordon.checks.json is fully
// schema-validated — a consumer's command entries get the same editor
// autocomplete and type-checking as a built-in check's config.
const EFFECT_LADDER = ['read', 'local_write', 'vault_write', 'remote_write', 'deploy'];
const PHASES = ['pre-build', 'build', 'post-build'];

const ENGINE_PROPERTIES = {
  enable: {
    type: 'array',
    items: { type: 'string' },
    description: "Turn ON a check that is off by default here — an opt-in catalog check (e.g. the heavy `playwright` suite). Names only; everything else (effect, command, fix) is cordon's. Run `node checks/run.mjs --list` to see what applies.",
  },
  disable: {
    type: 'array',
    items: { type: 'string' },
    description: "Turn OFF an auto-detected check by id (e.g. `pip-audit`, or a discovered `check:*` script). The bare-minimum way to drop a check: just its name, no other config.",
  },
  builtDirs: {
    type: 'array',
    items: { type: 'string' },
    default: ['dist', 'dist.nosync'],
    description: 'Candidate build-output dirs (first non-empty one wins). Drives the `built-dir` capability and the post-build invariants, so they agree on where the build is.',
  },
  runner: {
    type: 'string',
    default: 'ubuntu-latest',
    description: "GitHub Actions runner the reusable cordon gate runs this repo on. Default ubuntu-latest; set 'macos-latest' for a repo that needs macOS (Keychain, a brew toolchain). Read by the gate, not the engine — so the caller's ci.yml stays the identical bare gate call, with the per-repo runner living here as data.",
  },
  packages: {
    type: 'string',
    default: '',
    description: "Extra check tooling the gate installs beyond its shellcheck + ripgrep base, space-separated (brew formulae on macOS, apt names on Linux), e.g. 'bash zsh bats-core age jq'. Read by the gate, not the engine.",
  },
  commands: {
    type: 'array',
    description: "Escape hatch for a repo-specific spawned spec cordon's catalog doesn't already cover. Most repos need none — language presets auto-detect (uv/Django/cordon-tool/shell/node-web) and package.json `check:*` scripts are discovered. Reach for this only for a genuinely bespoke check; declare its blast-radius `effect`. An id here overrides a catalog check of the same id.",
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'effect', 'exec'],
      properties: {
        id: { type: 'string', minLength: 1, description: 'Stable id (verdict key, --only target). Unique across built-in checks too.' },
        name: { type: 'string', description: 'Human title for the verdict; defaults to id.' },
        effect: { enum: EFFECT_LADDER, description: "Blast radius an agent risk-gates on (cordon's ladder). Required — an unclassified spec must never run as a safe read." },
        network: { const: true, description: 'Set only when the spec itself reaches off-box.' },
        interactive: { const: true, description: 'Set only when the spec blocks on a TTY.' },
        requires: { type: 'array', items: { type: 'string' }, description: 'Capabilities it needs (git/macos/ci/built-dir, file:<path>, glob:<pattern>, <binary>, or !cap to negate); the engine skips it fail-soft when unmet.' },
        phase: { enum: PHASES, description: 'Where it runs around the build. Default pre-build.' },
        default: { const: 'off', description: "Set to 'off' to make this an opt-in check — it runs only when its id is in `enable`. Omit for the normal on-when-detected behavior." },
        timeout: { type: 'integer', minimum: 1, description: 'Kill the spec after this many ms rather than wedge the gate.' },
        fix: { type: 'string', description: 'One-line remediation shown on failure.' },
        exec: {
          type: 'object',
          additionalProperties: false,
          required: ['cmd'],
          description: 'The process to spawn from the repo root.',
          properties: {
            cmd: { type: 'string', minLength: 1 },
            args: { type: 'array', items: { type: 'string' } },
            env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra env, merged over the process env.' },
          },
        },
      },
    },
  },
};

export function buildConfigSchema() {
  const properties = {
    // A config file may reference this very schema; allow (don't flag) the key.
    $schema: {
      type: 'string',
      description: 'Reference to this schema for editor autocomplete and validation.',
    },
    ...ENGINE_PROPERTIES,
  };
  // Both built-in tiers contribute a config key: in-process invariants (CHECKS)
  // and the auto-detected command catalog (CATALOG, e.g. pytest's pythonVersions).
  // A check with no config seam still gets an entry, so a reader sees every
  // available knob (and an empty object is the only valid value). Repo-authored
  // commands[] and discovered check:* scripts are not cordon-owned, so they don't.
  for (const c of [...CHECKS, ...CATALOG]) {
    properties[c.id] = c.configSchema ?? {
      type: 'object',
      additionalProperties: false,
      description: `Config for the "${c.name}" check — no options.`,
    };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_ID,
    title: 'cordon.checks.json',
    description:
      "Per-repo configuration for cordon's checks engine — and usually the whole file "
      + "is optional. Checks auto-detect from the repo's stack; the common case is no file at all. "
      + "Reach for one only to deviate: `enable`/`disable` flip a check by name (the bare minimum), "
      + "a check-id key tunes a built-in check's options, and `builtDirs`/`commands` configure the "
      + "engine. Run `node checks/run.mjs --list` to see exactly what runs here.",
    type: 'object',
    additionalProperties: false,
    properties,
  };
}
