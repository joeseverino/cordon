// The single source of truth for cordon's portable checks — the repo-agnostic
// invariant verifiers a consuming repo references (never vendors), exactly as it
// references conformance/validate.ts. A gate derives its check list from here,
// so completeness is structural: add a check here and every gate that claims it
// picks it up. This is the inventory; checks/run.ts is the run logic.
//
// These are the engine's built-in **invariants** — in-process checks portable to
// any tool/CLI/MCP repo. A repo's own **command** entries (spawned specs like
// `tsc` or a bespoke audit) are declared as data in its cordon.checks.json and
// merged in at run time; they stay home because they assert that repo's
// behavior. Invariant definitions graduate up here; command definitions don't.
// (See checks/README.md.)
//
// An invariant is a module exporting { id, name, effect, gates, fix, run(ctx) },
// plus optional { configSchema, requires, phase, repair(ctx) } — the `Check`
// type in lib/types.ts:
//   • repair(ctx) — the autofix seam: mechanical remediation for what run(ctx)
//     flags. Invoked only under --fix, and the engine re-runs the check after —
//     a repair is proven by its verifier, never trusted. Return { ok, detail }
//     ({ ok: false } marks the repair itself as failed). Export it only where
//     the remediation is deterministic and safe to apply unattended.
//   • configSchema — a JSON Schema fragment for its slice of cordon.checks.json;
//     config-schema.ts composes these into the published file schema and each
//     check derives its runtime defaults from the same source (emit once).
//   • requires — capabilities it needs (capabilities.ts vocabulary); the engine
//     skips it fail-soft when unmet, so e.g. a `!ci` check runs only on an
//     authoring machine. Absent ⇒ always runnable.
//   • phase — pre-build | build | post-build for gate ordering. Absent ⇒ pre-build.
// ctx = { root, config }. The `effect` is cordon's blast-radius ladder applied
// to the check itself (a `read` invariant is safe anywhere); see
// checks/lib/repository-policy.ts for the reference contract. Unlike a *test*
// (which asserts a specific repo's code and stays in that repo), an invariant
// asserts a general rule and is portable — that's why it lives here.
import repositoryPolicy from './lib/repository-policy.ts';
import idempotence from './lib/idempotence.ts';
import dispatchDups from './lib/dispatch-dups.ts';
import batsAssertions from './lib/bats-assertions.ts';
import type { Check } from './lib/types.ts';

export const CHECKS: Check[] = [
  repositoryPolicy,
  idempotence,
  dispatchDups,
  batsAssertions,
];

export const checksFor = (gate?: string): Check[] => CHECKS.filter((c) => !gate || c.gates.includes(gate));
