// Composes the JSON Schema for a repo's `cordon.checks.json` from the registry —
// the editor/AI-facing analog of a command's `--describe`. Each check owns its
// config contract (`configSchema`); this folds them into one document keyed by
// check id, so completeness is structural: register a check with a configSchema
// and it appears here (and in every editor pointed at the published file) with
// no second edit. `checks/run.mjs --schema` is the reference emitter; the
// committed `checks/config.schema.json` is the published artifact the `$schema`
// URL serves, kept fresh by cordon's own dogfooded idempotence check.
import { CHECKS } from './registry.mjs';

// The stable home the published schema is served from — what a consuming repo's
// `cordon.checks.json` points its `$schema` at for editor autocomplete + AI.
export const SCHEMA_ID =
  'https://raw.githubusercontent.com/joeseverino/cordon/main/checks/config.schema.json';

// The two engine-level keys (not per-check): where the build emits, and the
// repo's own spawned specs. Declared here so cordon.checks.json is fully
// schema-validated — a consumer's command entries get the same editor
// autocomplete and type-checking as a built-in check's config.
const EFFECT_LADDER = ['read', 'local_write', 'vault_write', 'remote_write', 'deploy'];
const PHASES = ['pre-build', 'build', 'post-build'];

const ENGINE_PROPERTIES = {
  builtDirs: {
    type: 'array',
    items: { type: 'string' },
    default: ['dist', 'dist.nosync'],
    description: 'Candidate build-output dirs (first non-empty one wins). Drives the `built-dir` capability and the post-build invariants, so they agree on where the build is.',
  },
  commands: {
    type: 'array',
    description: "This repo's own spawned specs (playwright, tsc, a bespoke audit) — merged with cordon's built-in invariants and run by the same engine. Spec code stays in the repo; this is just the inventory.",
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
        requires: { type: 'array', items: { type: 'string' }, description: 'Capabilities it needs (git/macos/ci/built-dir/<binary>, or !cap to negate); the engine skips it fail-soft when unmet.' },
        phase: { enum: PHASES, description: 'Where it runs around the build. Default pre-build.' },
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
  for (const c of CHECKS) {
    // A check with no config seam still gets an entry, so a reader sees every
    // available knob (and an empty object is the only valid value).
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
      "Per-repo configuration for cordon's checks engine. Most keys are a check id "
      + "(omit one to use that check's defaults); `builtDirs` and `commands` configure the "
      + "engine itself. Run `node checks/run.mjs --list` to see every check that applies here.",
    type: 'object',
    additionalProperties: false,
    properties,
  };
}
