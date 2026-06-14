# Changelog

Cordon versions on two axes:

- the **on-wire `schema_version`** — the contract revision, tracked by the schema
  URL (`cordon-v4.json` ↔ `schema_version: 4`). A breaking contract change ships a
  new `cordon-vN.json`; old consumers keep validating against the version they
  pin. This is the number that matters to emitters and consumers.
- the **repo release** below (SemVer) — the spec, schema, harness, docs, and
  examples as a package. Doc/tooling/example changes move only this axis.

## [Unreleased]

### Changed
- `docs/EMITTERS.md` links each registry row to its live emitter repo and key
  implementation file, so a newcomer can jump straight to reference
  implementations.

### Added
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
