# The Cordon framework

The contract answers *what happens if I run this*. The checks answer *is this
repo shippable*. This layer answers the third question: **how do you build a
tool that earns both answers** — the method behind the repos that emit Cordon
contracts.

Boundary, stated up front: nothing in this folder is wire format. The schema
stays frozen and normative on its own terms ([`AGENTS.md`](../AGENTS.md),
"Versioning"). The framework is the build method — guidance a fresh agent or
human follows when creating a new tool — and amending it never touches v4.

The framework has three legs:

| leg | where | answers |
|---|---|---|
| Contract | [`schema/`](../schema/) + [`fixtures/`](../fixtures/) + [`docs/IMPLEMENTERS.md`](../docs/IMPLEMENTERS.md) | what a tool declares |
| Proof | [`checks/`](../checks/) + [`conformance/`](../conformance/) + [`harness/`](../harness/) | what a repo demonstrates |
| Scaffold | [`cordon-starter`](https://github.com/joeseverino/cordon-starter) | the tree you start from, cornerstones pre-wired |

Building a new tool? Skip to [`AGENT-BRIEF.md`](AGENT-BRIEF.md) — it is the
operational entry point and reading order. This file holds the rules the brief
enforces.

## The method — twelve principles

Each principle was learned building real repos against the contract, then kept
because dropping it caused drift, rot, or risk. Under each principle sit the
practices that instantiate it — harvested from the fleet's own house docs, kept
here only where they generalize. Repo-specific technique stays in each repo's
`AGENTS.md`; this file is the part that transfers.

### 1. One owner per fact

Every fact — and every *decision* — has exactly one declaration; every other
surface derives from it. Docs that relate to an owned fact point at the owner;
they never restate it.

- Validation rules live in one schema contract that every consumer (doctor,
  writers, projections) derives from; never restate a field or enum list in a
  second place.
- A workflow has one read owner and one write owner — one scanner, one merge
  path, one branch-safety heuristic. Never add a second.
- One implementation per capability (one parser, one write substrate, one
  resolver); a rival implementation is deleted, not left dormant.
- Edit the upstream source, never the generated block — regenerated artifacts
  wipe hand edits by design.
- A vendored copy of a canonical file is diffed against its source by a check,
  so it can't silently drift.
- Stable identifiers are immutable even when files move; outdated docs flip to
  `deprecated` rather than being deleted.

### 2. Emit once, render many

Tools and services emit data, not presentation. One computation, then N
renderers — human help, machine JSON, guards, TUIs — all reading the same
structured payload so they cannot drift. No program ever parses prose to
recover a fact another program already knows.

- Downstream consumers read the *published projection*, never the source of
  truth directly — and the projection fails closed on schema drift, so nothing
  builds from bad facts.
- Error messages derive from the contract too: unknown input shows the valid
  surface from the spec, not a hand-written "(try -h)" string.
- Caches of derived artifacts are acceleration, never canonical content, and
  are keyed by a content hash over their inputs — correctness never lags
  content, and staleness is structurally impossible.

### 3. Every tool gets two faces

A human face and a machine face (`--json` / `--describe` / an API tool),
produced from the same code path. If an agent would have to grep for something
the tool already computes, that is a missing machine face, not a search
problem.

- CLI and MCP (or any two faces) are peer adapters over one service layer;
  neither face calls through the other, and both resolve the same explicit
  config passed in — never shared via mutated process environment.
- Face parity is machine-checked against a committed inventory, not promised
  in prose.
- Every service call returns one JSON object with a uniform envelope —
  `{ok: true, …}` / `{ok: false, error: "…"}` — and exits 0/1 on `ok`.

### 4. Blast radius is first-class

Every command declares its `effect` on the ladder
`read < local_write < vault_write < remote_write < deploy` (plus `network` /
`interactive` when true). A `status` must never be confusable with a `ship`;
callers gate on the declared effect *before* acting.

- A write is declared, never inherited: a missing effect declaration fails
  closed (or defaults to `read`) — it can never silently become a write.
- Machine-face writes default to dry-run; applying requires explicit opt-in.
  Some writes are deliberately human-only and never exposed to the machine
  face at all.
- Never expose a write that takes an arbitrary path plus free text: if you
  can't name the file shape, validate its fields, and report exactly what
  changed, it isn't a write tool yet.
- Validate everything before the first byte of I/O — fail before disk, not
  mid-write.

### 5. Deterministic output

Nothing emitted carries timestamps, unstable ordering, or runtime noise.
Determinism is what makes committed goldens diffable and drift checks
possible; it is a feature, not a constraint.

- Gates and validation are side-effect-free: a release fails if running the
  checks dirtied the worktree.

### 6. The gate defines done

The repo runs the same gate locally that CI runs, from one definition, so a
local pass *means* a CI pass. Hooks are wired per clone so red never leaves
the machine.

- Tests are hermetic: fake stores and tmpdirs on disk, no live hosts, no real
  keychains. Every external binary or service crossing goes through one
  overridable seam so tests can stub it.
- All gates are enumerated in one registry and run through one harness with
  per-check timeouts; the runner aggregates every failure into one structured,
  re-runnable report instead of stopping at the first.
- Budgets (page weight, accessibility, performance) are CI gates, not
  aspirations; every measured claim in a README has a bench script that
  asserts it.
- Operational discipline is *checked, not remembered*: a "remember to sync"
  rule becomes recorded state plus a doctor check that reports staleness.
- The shell face runs the installed artifact, and a stale install is real
  drift — caught by a fingerprint check, not by surprise.
- Pre-merge gates are deterministic and repo-local; live verification against
  external state is a separate, post-deploy step. Verify with the project's
  own pipeline and by driving the real thing — never by model intuition, and
  don't trust a watcher's exit code over the gate's actual recorded verdict.

### 7. Contracts over convention

A command surface is introspected from the parser or declared in one DSL —
never described by hand in prose. The emitted contract is committed as a
golden and checked against the live `--describe` so the two cannot silently
diverge.

- A contract shared across systems is committed as data and validated on both
  sides, with a fingerprint check for drift.
- A frozen contract version is never silently broadened; a new structured
  concept gets a new version with fixtures and coordinated support.
- Surfaces owned by another repo are pointed at with a structured delegation
  marker, never re-enumerated.

### 8. Register-governed crossings, failing closed

Anything that mutates an external system goes through a connector governed by
an explicit register. Unregistered targets fail, closed, by design.

- Planning is pure (desired vs. existing → a list of actions); every
  external-system crossing is isolated in a thin connector that carries zero
  business logic and emits one JSON payload.
- Reconcilers act only on records they themselves stamped (namespaced
  markers), so automation coexists with human-owned data it never touches.
- Trust boundaries are crossed with allowlists that drop by omission — never
  denylists — and any sync/copy boundary refuses paths that resolve outside
  its source.
- Sensitive reads go through a sensitivity gate that is never weakened;
  exposure is opt-in and audited, and audit records carry actions and counts,
  never bodies. Classify conservatively — a label can be loosened later, but a
  too-open doc can't be unsaid.

### 9. Idempotent by construction

Scripts and migrations read the current state before re-deriving it, so a
re-run preserves what a previous run already produced. If a tool needs a
"don't run twice" warning, that is a smell, not a caveat.

- Builds run from a committed snapshot and never depend on the source of
  truth being reachable at build time; upstream-derived inputs keep a
  committed fallback so an outage or rate limit can't break a deploy.
- Enforcement rolls out in report-only mode first and is promoted to blocking
  only after observing compliant traffic.

### 10. Docs carry their proof

Diagram source and rendered output are committed side by side and regenerated
by one canonical renderer. Decision records log intent and point at the
implementing doc (principle 1 applies to decisions too). Significant features
get a case study — writing it is part of the feedback loop, not an
afterthought.

- Docs ship in the same commit as the code they document, never a follow-up.
- Docs are gated artifacts: registered, cross-linked, with internal links and
  script references machine-checked.
- Structured metadata is mandatory — an unregistered artifact is invisible to
  the system, by design.
- An explicit publish flag gates what crosses the public boundary;
  unpublished stays private.

### 11. Cores are generic; domains are skins

A shared engine is composed, never forked: generic behavior changes upstream
(release, bump the pin), and domain vocabulary — enums, field names, profile
values — never enters the core.

- Prefer configuration over code: if the core covers the need, the domain
  repo writes almost nothing, and a tool duplicating a core capability is
  rejected.
- A thin composition root wires one shared context into the generic and
  domain faces; business logic lives in neither the wiring nor either face.
- Schema profiles are mutually exclusive fences — one domain's types are
  rejected by another domain's server, by design.
- Shared code has an explicit public boundary (an `sdk/` surface); consumers
  import the narrowest module, and compatibility aggregators are not
  destinations for new code.
- Config is environment-first with one fixed resolution order and one
  resolver; no module opens the config file itself, and no machine path is
  hardcoded.

### 12. Governance is pre-wired, even solo

The scaffold ships the workflow so discipline is structural, not
remembered: branch → PR → green gate → merge (squash), on every repo,
including solo ones. Commits are solo-authored with no AI attribution.

- Publishing uses OIDC trusted publishing with provenance — no long-lived
  tokens; CI actions are pinned to digests and workflows run least-privilege.
- The security dashboard at zero open alerts is a release signal; a
  non-applicable finding is dismissed with a written reason, not ignored.

## Amending the framework

A gap between these principles and what a real build needs means this folder
gets amended — never silently bypassed. Rule changes ride the normal
branch → PR → gate workflow; they are cheap precisely because they are not
wire-format changes.
