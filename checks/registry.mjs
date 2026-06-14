// The single source of truth for cordon's portable checks — the repo-agnostic
// invariant verifiers a consuming repo references (never vendors), exactly as it
// references conformance/validate.mjs. A gate derives its check list from here,
// so completeness is structural: add a check here and every gate that claims it
// picks it up. This is the inventory; checks/run.mjs is the run logic.
//
// These are the engine's built-in **invariants** — in-process checks portable to
// any repo. A repo's own **command** entries (spawned specs like `playwright`,
// `tsc`) are declared as data in its cordon.checks.json and merged in at run time;
// they stay home because they assert that repo's behavior. Invariant definitions
// graduate up here; command definitions don't. (See checks/README.md.)
//
// An invariant is a module exporting { id, name, effect, gates, fix, run(ctx) },
// plus optional { configSchema, requires, phase }:
//   • configSchema — a JSON Schema fragment for its slice of cordon.checks.json;
//     config-schema.mjs composes these into the published file schema and each
//     check derives its runtime defaults from the same source (emit once).
//   • requires — capabilities it needs (capabilities.mjs vocabulary); the engine
//     skips it fail-soft when unmet, so e.g. a `built-dir` check runs only after a
//     build. Absent ⇒ always runnable.
//   • phase — pre-build | build | post-build for gate ordering. Absent ⇒ pre-build.
// ctx = { root, config, builtDirs }. The `effect` is cordon's blast-radius ladder
// applied to the check itself (a `read` invariant is safe anywhere); see
// checks/lib/repository-policy.mjs for the reference contract. Unlike a *test*
// (which asserts a specific repo's code and stays in that repo), an invariant
// asserts a general rule and is portable — that's why it lives here.
import repositoryPolicy from './lib/repository-policy.mjs';
import idempotence from './lib/idempotence.mjs';
import internalLinks from './lib/internal-links.mjs';
import structuralHtml from './lib/structural-html.mjs';

export const CHECKS = [
  repositoryPolicy,
  idempotence,
  internalLinks,
  structuralHtml,
];

export const checkById = (id) => CHECKS.find((c) => c.id === id);
export const checksFor = (gate) => CHECKS.filter((c) => !gate || c.gates.includes(gate));
