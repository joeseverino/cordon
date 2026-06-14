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

export function buildConfigSchema() {
  const properties = {
    // A config file may reference this very schema; allow (don't flag) the key.
    $schema: {
      type: 'string',
      description: 'Reference to this schema for editor autocomplete and validation.',
    },
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
      "Per-repo configuration for cordon's portable checks. Each top-level key is a check id; "
      + "omit a key to use that check's defaults. Run `node checks/run.mjs --list` to see every check.",
    type: 'object',
    additionalProperties: false,
    properties,
  };
}
