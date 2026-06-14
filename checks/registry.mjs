// The single source of truth for cordon's portable checks — the repo-agnostic
// invariant verifiers a consuming repo references (never vendors), exactly as it
// references conformance/validate.mjs. A gate derives its check list from here,
// so completeness is structural: add a check here and every gate that claims it
// picks it up. This is the inventory; checks/run.mjs is the run logic.
//
// A check is a module exporting { id, name, effect, fix, gates, run(ctx) }; see
// checks/lib/repository-policy.mjs for the contract. The `effect` is cordon's own
// blast-radius ladder (read | local_write | … | deploy) applied to the check
// itself, so an agent reads the verdict and the cost of producing it in one
// vocabulary — a `read` check is safe to run anywhere; a `network` one reaches
// off-box. Unlike a *test* (which asserts behavior of code a specific repo wrote,
// and so stays in that repo), a check asserts a general invariant and is portable
// — that's why it lives here.
import repositoryPolicy from './lib/repository-policy.mjs';

export const CHECKS = [
  repositoryPolicy,
];

export const checkById = (id) => CHECKS.find((c) => c.id === id);
export const checksFor = (gate) => CHECKS.filter((c) => !gate || c.gates.includes(gate));
