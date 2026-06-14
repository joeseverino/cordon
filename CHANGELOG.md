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
