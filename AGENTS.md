# AGENTS.md

Cordon is a language-agnostic JSON contract for command-line surfaces. Keep the
wire format small, deterministic, and honest about operational risk.

## Read This First

Use the repository in this order:

1. [`schema/cordon-v4.json`](schema/cordon-v4.json) — the canonical wire format.
2. [`fixtures/`](fixtures/) — executable examples of what must pass or fail.
3. [`docs/IMPLEMENTERS.md`](docs/IMPLEMENTERS.md) — how to build an emitter.
4. [`docs/EMITTERS.md`](docs/EMITTERS.md) — known implementations.
5. [`docs/DIAGRAM-CASE-STUDY.md`](docs/DIAGRAM-CASE-STUDY.md) — a complete,
   small leaf-tool example and implementation feedback.

Do not infer contract behavior from README prose when the schema or fixtures
answer the question directly.

## Contract Rules

- Every tool and command has an `effect`:
  `read | local_write | vault_write | remote_write | deploy`.
- `network: true` means the requested operation itself reaches a remote system,
  API, or SSH endpoint. Dependency installation, package-manager resolution,
  and cache misses do not count.
- `interactive: true` means the operation blocks on a TTY or prompt.
- `network` and `interactive` are emitted only when true.
- Output is deterministic: no timestamps, unstable ordering, or runtime noise.
- `paras` contains one complete, unwrapped logical paragraph per item.
- Emit only schema-defined keys; `additionalProperties: false` is deliberate.

## Versioning

Treat v4 as frozen. Adding an optional field is still a wire-format change
because existing v4 validators reject unknown properties.

Do not add fields to `cordon-v4.json`. A new structured concept requires:

1. a new `schema/cordon-vN.json`;
2. matching valid and invalid fixtures;
3. conformance harness coverage;
4. implementer and versioning documentation; and
5. coordinated emitter/consumer support.

Dependency/runtime metadata is a candidate for v5. Until then, pin dependencies
in the implementation and describe requirements in existing prose fields or
implementation documentation.

## Common Tasks

### Document or clarify v4

Edit README/docs without changing the schema. Keep examples schema-valid.

### Add an emitter

Implement against the schema and fixtures, validate its `--describe` output,
then add it to `docs/EMITTERS.md`.

### Change the contract

Create a new schema version. Never silently broaden v4.

### Add a diagram

Keep source and output together under `docs/diagrams/`:

```sh
diagram docs/diagrams/
```

Commit both `.mmd` and `.png`, then link the source and canonical renderer.

## Verification

Run:

```sh
npm test
git diff --check
```

For an external emitter:

```sh
some-tool --describe | node conformance/validate.mjs -
```
