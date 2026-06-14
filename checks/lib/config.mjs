// Shared helper for the checks' config seam — NOT a check (the registry imports
// checks by name, so this `_`-free sibling is never mistaken for one; it carries
// no `id`).
//
// Cordon ideology: one source, many renderings. A check declares its config once
// as a JSON Schema fragment (`configSchema`) — that single declaration drives
// BOTH the editor/AI-facing schema (composed in config-schema.mjs) AND the
// check's runtime defaults, extracted here. So a field's type, its docs, and its
// default value can never drift from each other: there is only one place to edit.

// defaultsOf(configSchema) -> { field: default, … }
// Lifts each property's `default` out of a check's configSchema into the plain
// object the check merges user config over. Deep-cloned so a check (or a caller)
// mutating its merged config can never write through to the shared schema.
export function defaultsOf(configSchema) {
  const props = configSchema?.properties ?? {};
  const out = {};
  for (const [key, spec] of Object.entries(props)) {
    if ('default' in spec) out[key] = structuredClone(spec.default);
  }
  return out;
}
