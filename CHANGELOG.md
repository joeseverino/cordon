# Changelog

Cordon versions on two axes:

- the **on-wire `schema_version`** — the contract revision, tracked by the schema
  URL (`cordon-v4.json` ↔ `schema_version: 4`). A breaking contract change ships a
  new `cordon-vN.json`; old consumers keep validating against the version they
  pin. This is the number that matters to emitters and consumers.
- the **repo release** below (SemVer) — the spec, schema, harness, docs, and
  examples as a package. Doc/tooling/example changes move only this axis.

Releases from v1.1.0 on are cut by [release-please](https://github.com/googleapis/release-please):
the sections below this line are generated from Conventional Commit titles.

## [1.1.0](https://github.com/joeseverino/cordon/compare/v1.0.0...v1.1.0) (2026-06-16)


### Features

* **catalog:** graduate readme-sync + version-alignment from repo commands ([8709ef6](https://github.com/joeseverino/cordon/commit/8709ef6b2b830655c03dfc6cc9a427d8ae36738e))
* **catalog:** graduate readme-sync and version-alignment from repo commands ([c793186](https://github.com/joeseverino/cordon/commit/c79318649edc01c9385d9ff7e539336754c71b0f))
* checks verdict contract (cordon-checks-v1) + effect on checks ([8f7e15b](https://github.com/joeseverino/cordon/commit/8f7e15b3c0995c32b76f733d7467149390fd8e33))
* **checks:** derive cordon.checks.json schema from each check's configSchema ([f4f4ee7](https://github.com/joeseverino/cordon/commit/f4f4ee787503d8a7bf7f10c535f402fbdad8e7a0))
* **checks:** derive cordon.checks.json schema from each check's configSchema ([7ff215f](https://github.com/joeseverino/cordon/commit/7ff215fbc9c1296c3fd5586f3139be79ef12cbed))
* **checks:** grow the runner into a portable gate engine (v2) ([38397a9](https://github.com/joeseverino/cordon/commit/38397a907506fe095ed113b9cab1a9defca5e18f))
* **checks:** package-smoke — built wheel must import ([6f15cb8](https://github.com/joeseverino/cordon/commit/6f15cb8a884e294f6bb2c08a85986dd6d558a135))
* **checks:** polished, always-there-in-CI run report ([b7267ae](https://github.com/joeseverino/cordon/commit/b7267aedf62a46930d20c4ec6ffc60d8995c665c))
* **checks:** polished, always-there-in-CI run report ([e12fda4](https://github.com/joeseverino/cordon/commit/e12fda4edb4e5184cba98f8d859c05f1cc6a0339))
* **checks:** portable gate engine + cordon-checks-v2 ([9981ef2](https://github.com/joeseverino/cordon/commit/9981ef2e1e2b50968ee771e716614d6c5e276309))
* **checks:** pytest runs the Python version matrix as one check ([6cd7921](https://github.com/joeseverino/cordon/commit/6cd7921d44170ff557a41a8ad66ad95751e8714f))
* **checks:** stack auto-detection catalog + script discovery + enable/disable ([3c2b04c](https://github.com/joeseverino/cordon/commit/3c2b04c7a0163e8d1015b172b57388fa2b3ec85b))
* **checks:** stack auto-detection catalog, script discovery, enable/disable ([515dd70](https://github.com/joeseverino/cordon/commit/515dd7006e25559436b3bc823cbc28d2d939d7ad))
* **emitters:** Python reference emitter — introspect argparse to a v4 contract ([d606194](https://github.com/joeseverino/cordon/commit/d6061945f760cb7a94997bc05bbb903e4c120238))
* **emitters:** Python reference emitter — introspect argparse to a v4 contract ([4850d69](https://github.com/joeseverino/cordon/commit/4850d69fd6310df64bbff20cc19e0dc9ffb8db12))
* enforce semantic contract invariants ([32fe5b3](https://github.com/joeseverino/cordon/commit/32fe5b3cf584573b6ccc764adab3b49240b9944a))
* graduate the idempotence check + document gates/phases ([d967196](https://github.com/joeseverino/cordon/commit/d967196a63c0b22c511df69a9760eb453283ed4c))
* **install:** one-time bootstrap — clone cordon + wire CORDON_HOME into ~/.zshrc ([b347a87](https://github.com/joeseverino/cordon/commit/b347a874e5e59fbeb9bc54de8db8b2dea3a0d6c7))
* local git hooks (pre-commit, commit-msg, pre-push) + setup-hooks.sh ([c9d3121](https://github.com/joeseverino/cordon/commit/c9d3121af8bd1ed21cf0a8e1c82a73e64d07f5bb))
* local git hooks + setup-hooks.sh ([a1d0322](https://github.com/joeseverino/cordon/commit/a1d0322cc89e77f763d3deb4ed08ab9a039f4303))
* portable repo-checks runner + repository-policy ([0a9f35c](https://github.com/joeseverino/cordon/commit/0a9f35ccbf0f0f10449b6680373bb0a496f7535c))
* portable repo-checks runner + repository-policy ([de5555c](https://github.com/joeseverino/cordon/commit/de5555c753d5d66b039746a62da97479495f324d))


### Bug Fixes

* **gate:** run the repo's own check.sh --ci; README checks schema → v2 ([54864a9](https://github.com/joeseverino/cordon/commit/54864a9e8e956e75f9e2f28eba66e418acb3904e))
* **gate:** run the repo's own scripts/check.sh --ci; README checks schema → v2 ([bf2f4df](https://github.com/joeseverino/cordon/commit/bf2f4dfdcf96b26b70622697ffd1ffc4f5700114))

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

[1.0.0]: https://github.com/joeseverino/cordon/releases/tag/v1.0.0
