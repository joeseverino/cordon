# Agent brief — build a tool the Cordon way

This file is the entry point for an AI agent (or human) told:

> *"Create `<tool>`, following the Cordon framework. Read
> `framework/AGENT-BRIEF.md` in the cordon repo and meet it."*

Everything you need is in this repo and the starter template. Do not infer the
standard from other repos' code; they implement this brief, not the reverse.

## Reading order

1. This file — the requirements and definition of done.
2. [`framework/README.md`](README.md) — the method (twelve principles, each
   with the practices that instantiate it) the requirements enforce.
3. [`schema/cordon-v4.json`](../schema/cordon-v4.json) — the wire format your
   `--describe` must satisfy. [`fixtures/`](../fixtures/) are executable
   examples of what must pass and fail.
4. [`docs/IMPLEMENTERS.md`](../docs/IMPLEMENTERS.md) — how to build the
   emitter (DSL or parser introspection).
5. [`checks/README.md`](../checks/README.md) — the repo-level gate and
   `cordon.checks.json`.
6. [`docs/DIAGRAM-CASE-STUDY.md`](../docs/DIAGRAM-CASE-STUDY.md) — one
   complete, small example end to end.

## Start from the scaffold

New repos begin from
[`cordon-starter`](https://github.com/joeseverino/cordon-starter) — copy or
"Use this template", then prune. Its `README.md` walks the exact commands; its
`AGENTS.md` is the in-repo playbook (git workflow, CI, checks config,
verification). The starter ships two emitter tracks (bash and Node); keep one.
Adding a tool to an existing Cordon-conformant repo? Skip the scaffold and
follow that repo's `AGENTS.md`; the requirements below still apply.

## Requirements

Numbered so a review can cite them. Principle references point into
[`framework/README.md`](README.md).

1. **Declare the surface once** — a `describe_spec()` DSL or parser
   introspection, never prose (principles 1, 7). Human `--help` and machine
   `--describe` render from this one declaration.
2. **Every command carries an `effect`** on the ladder, plus `network` /
   `interactive` only when true (principle 4). If you are unsure between two
   rungs, declare the higher one.
3. **`--describe` validates**: pipe it through
   `node conformance/validate.mjs -` and commit the emitted contract as a
   golden under `contract/` (principles 5, 7). Never hand-edit the golden.
4. **Machine face for anything computed** (principle 3) — if the tool derives a
   fact a caller might want, expose it as structured output, not log prose;
   service-style returns use the uniform `{ok, …}` / `{ok: false, error}`
   envelope with exit 0/1.
5. **Deterministic emissions** (principle 5) — no timestamps, no unstable ordering,
   no runtime noise in anything committed or diffed.
6. **Wire the gate**: `cordon.checks.json` at the repo root, `scripts/check.sh`
   green locally, CI calling the reusable gate (principle 6). The starter has all
   three pre-wired.
7. **External mutations go through a register** and fail closed; bulk writes
   default to dry-run (principle 8). No ad-hoc side channels to systems of record.
8. **Idempotent scripts** — re-running any setup, sync, or migration preserves
   the state a previous run produced (principle 9).
9. **Docs prove themselves** (principle 10): README stays in sync with the contract
   (generated, or covered by a sync check); diagrams committed as source +
   render together.
10. **Repo hygiene**: `AGENTS.md` with a `CLAUDE.md` symlink, `CHANGELOG.md`,
    a single version source, hooks enabled per clone
    (`scripts/setup-hooks.sh`), work on a branch — never on `main`.

## Definition of done

A build is done when all of these hold — not before, and claiming otherwise
is the failure mode this framework exists to prevent:

```sh
<tool> --describe | node conformance/validate.mjs -   # contract validates
scripts/check.sh                                       # repo gate green
git diff --check                                       # no whitespace damage
```

plus: the committed golden matches live `--describe` output, and every
requirement above is either met or explicitly waived in the PR description
with a reason.

## When the brief doesn't fit

If a requirement genuinely cannot apply to the tool at hand, say so where the
work is reviewed and propose the amendment — the framework gets changed by PR
([`framework/README.md`](README.md), "Amending the framework"), never silently
ignored.
