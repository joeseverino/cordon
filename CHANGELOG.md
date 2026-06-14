# Changelog

Cordon versions on two axes:

- the **on-wire `schema_version`** — the contract revision, tracked by the schema
  URL (`cordon-v4.json` ↔ `schema_version: 4`). A breaking contract change ships a
  new `cordon-vN.json`; old consumers keep validating against the version they
  pin. This is the number that matters to emitters and consumers.
- the **repo release** below (SemVer) — the spec, schema, harness, docs, and
  examples as a package. Doc/tooling/example changes move only this axis.

## [Unreleased]

### Added
- **`checks/example-report.md`** — a committed, permanent example of a run report
  (a failing CI run, from a real run summary, plus a green run), linked from
  `checks/README.md`. A stable artifact to point at instead of a transient CI run.
- **A one-glance `checks-engine-mini` diagram** at the top of `checks/README.md`
  (invariants + commands → engine → verdict); the full flow diagram moves down to
  a "The full flow" section, sized smaller.

### Changed
- **Checks report polish.** `.cordon-checks-report.md` gains a whole-picture
  **status table** (every check — pass/fail/skip — with its effect and, for a
  skip, *why*; so a skip is never mistaken for a pass), each failure's output
  folded in a `<details>`, and a provenance footer linking cordon + the author.
  It now writes **on failure** by default (a green local run leaves no file
  behind), with `--report` to force it and the `CI` env to enable it
  automatically — so the run summary is always there in CI without cluttering a
  local green run. Both CI workflows surface it to the run summary. The report
  and the `--json` verdict are two renders of one `results` source.
- `docs/EMITTERS.md` links each registry row to its live emitter repo and key
  implementation file, so a newcomer can jump straight to reference
  implementations.

### Added
- **The checks gate engine** — `checks/run.mjs` grows from an in-process invariant
  loop into the harness brains a consuming repo references instead of
  reimplementing. It now runs **two kinds of check** through one loop: cordon's
  built-in **invariants** (portable, in `registry.mjs`) and a repo's own
  **command** entries (spawned specs like `playwright`/`tsc`, declared as data in
  `cordon.checks.json` `commands[]`) — spec definitions stay home, the engine is
  central. Adds a **capability layer** (`checks/lib/capabilities.mjs`:
  `git`/`macos`/`ci`/`built-dir`/`<binary>`, with `!` negation) so a check declares
  what it `requires` and the engine **skips fail-soft** what the environment can't
  satisfy — the default posture is lean, a repo lights up only what it opts into.
  Adds **phases** (`pre-build` → `build` → `post-build`, capabilities re-detected
  between them so post-build checks see a fresh build) and `--phase`. The spawn
  harness (`checks/lib/run-process.mjs`) and built-output walking
  (`checks/lib/built-tree.mjs`) graduate from `jseverino.com`. A hermetic
  `checks/selftest.mjs` runs under `npm test`. Two reference post-build invariants
  graduate too: **`internal-links`** and **`structural-html`**. `checks/README.md`
  gets a plain-English engine diagram (`docs/diagrams/checks-engine.{mmd,png}`,
  the checks sibling of `emit-once` / `effect-ladder`).
- **Checks verdict `schema_version 2`** (`schema/cordon-checks-v2.json`) — v1 plus
  the two signals the engine adds: per-check **`phase`** and **`unmet`** (the
  capabilities a skipped check needed but the environment lacked), so an agent
  reads *why* a check skipped, not just that it did. v1 stays valid; the
  conformance harness now selects the verdict schema by `schema_version`, and
  `cordon-v4.json` stays frozen.
- **Derived `cordon.checks.json` schema** (`checks/config.schema.json`, emitted by
  `checks/run.mjs --schema`). Each check declares its config seam once as a
  `configSchema` fragment on its default export; `defaultsOf` (`checks/lib/config.mjs`)
  lifts that same declaration into the check's runtime defaults, and
  `checks/config-schema.mjs` composes the fragments over the registry into one
  published file schema. A consuming repo points its `cordon.checks.json`
  `$schema` at it for editor autocomplete, hover docs, and typo/type validation —
  and an agent reads the same machine contract. Adding a knob is one edit; type,
  docs, and default can't drift. Cordon dogfoods its own `idempotence` check
  (`cordon.checks.json`) to fail CI if the committed schema lags the source, so
  `npm run checks` now runs in CI alongside conformance.
- This changelog, and a `CLAUDE.md → AGENTS.md` symlink so AGENTS.md-aware tools
  and Claude Code read the same contributor guide.
- **Checks verdict contract** (`schema/cordon-checks-v1.json`) — the repo-level
  sibling of the command-surface schema. Where the surface answers *"what does
  running this command cost?"*, the verdict answers *"is this repo shippable, and
  what fixes each failure?"*. It is a separate, independently versioned schema
  (`schema_version: 1`), not a field on `cordon-v4.json`, which stays frozen. The
  schema requires the two signals an agent acts on: a failed check **must** carry
  `fix` + `rerun`. `checks/run.mjs --json` is the reference emitter, validated by
  the conformance harness (which now selects the schema by document shape:
  `commands[]` → surface, `checks[]` → verdict). Fixtures live under
  `fixtures/checks/{valid,invalid}/`.
- **`effect` on checks** — a check module now declares an `effect` on cordon's
  blast-radius ladder (plus `network` / `interactive`), so an agent reads the
  cost of *producing* a verdict in the same vocabulary as a command's
  `--describe`. It renders in the runner's human output and rides into the JSON.

## [1.0.0] — 2026-06-11

First public release. Contract: **`schema_version 4`**.

- **The contract** — one JSON document per tool, `additionalProperties: false`
  and byte-deterministic, with a required `effect` blast-radius class on the
  ladder `read → local_write → vault_write → remote_write → deploy`, plus the
  optional `network` / `interactive` tags (emitted only when `true`).
- **`schema/cordon-v4.json`** — the canonical JSON Schema (`$id`
  `https://jseverino.com/schemas/cordon-v4.json`).
- **`conformance/validate.mjs` + `fixtures/`** — the executable conformance
  suite: `fixtures/valid/` must pass, `fixtures/invalid/` must be rejected.
- **Docs** — `docs/IMPLEMENTERS.md` (how to write an emitter),
  `docs/EMITTERS.md` (the registry + federation), and the diagram case study.
- **Reference emitters** — `severino-tools` (Bash, *declare* via a `desc_*` DSL)
  and `severino-vault-mcp` (Python, *introspect* an `argparse` parser).

[Unreleased]: https://github.com/joeseverino/cordon/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/joeseverino/cordon/releases/tag/v1.0.0
