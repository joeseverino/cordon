# Conformance fixtures

Language-agnostic test vectors. Any Cordon emitter (in any language) is correct
when its output validates the way these say it should — point your validator at
the matching schema and run [`conformance/validate.mjs`](../conformance/validate.mjs).
The harness picks the schema by document shape: `commands[]` → the
command-surface contract (`schema/cordon-v4.json`); `checks[]` → the checks
verdict, then by its `schema_version` (`schema/cordon-checks-v1.json` or
`v2.json`), so versioned fixtures coexist under one sweep.

- **`valid/`** — documents a conformant emitter may produce. Must **pass**.
- **`invalid/`** — documents that must be **rejected**. Each isolates one rule.

## Command surface — `schema/cordon-v4.json`

| Fixture | Must | Rule it pins |
|---|---|---|
| `valid/leaf-tool.json` | pass | A leaf tool: tool-level `effect`, global options (incl. a repeatable, value-taking one), a variadic positional, empty `commands`. |
| `valid/subcommands.json` | pass | A command tool: per-command `effect` across the ladder (`read`/`deploy`/`remote_write`), `network`, `choices`, `delegates`. |
| `invalid/missing-effect.json` | reject | Every command must declare a blast radius (`effect` is required). |
| `invalid/bad-effect.json` | reject | `effect` must be one of the fixed ladder values. |
| `invalid/extra-key.json` | reject | `additionalProperties: false` — no smuggling tool-specific fields. |
| `invalid/duplicate-command.json` | reject | Command names are unique within a tool. |
| `invalid/incoherent-option.json` | reject | Option names/flags and value metadata must agree. |

## Checks verdict — `schema/cordon-checks-v{1,2}.json`

The repo-level sibling. Where the command-surface contract answers *"what does
running this command cost?"*, the verdict answers *"is this repo shippable, and
what fixes each failure?"* — the machine-readable output of
[`checks/run.mjs --json`](../checks/run.mjs). `durationMs` is the one runtime
field (a verdict is a report, not a static description); everything else is
deterministic — checks ride in registry/phase order and `failed[]` is derived.
**v2** adds two signals the gate engine emits: per-check `phase` (where it runs
around the build) and `unmet` (the capabilities a skipped check needed but the
environment lacked) — so an agent reads *why* a check skipped, not just that it
did. v1 stays valid; the version is pinned by `schema_version`.

| Fixture | Must | Rule it pins |
|---|---|---|
| `checks/valid/all-pass.json` | pass | A green v1 verdict: `ok: true`, empty `failed[]`, `report: null`, a `pass` check carrying its `effect`. |
| `checks/valid/with-failure.json` | pass | A red v1 verdict across the ladder: a `fail` with `fix`+`rerun`, a `skip`, and a `remote_write` check with `network`/`interactive`. |
| `checks/valid/v2-capability-skips.json` | pass | A v2 verdict: `phase`-ordered checks (`pre-build`→`build`→`post-build`), a binary+platform skip (`unmet: ["playwright","macos"]`), and a negated-capability skip (`unmet: ["!ci"]`). |
| `checks/invalid/missing-fix-on-failure.json` | reject | A `fail` check must carry remediation — `fix` **and** `rerun` are required when `status` is `fail`. |
| `checks/invalid/bad-status.json` | reject | `status` must be `pass`/`fail`/`skip`. |
| `checks/invalid/bad-effect.json` | reject | A check's `effect` must be one of the fixed ladder values. |
| `checks/invalid/extra-key.json` | reject | `additionalProperties: false` — no smuggling per-check fields. |
| `checks/invalid/inconsistent-verdict.json` | reject | `ok`, `failed`, `report`, and `checks[].status` must describe the same verdict. |
| `checks/invalid/v2-unmet-on-pass.json` | reject | `unmet` is the capability-skip reason — it may ride only a `skip`, never a `pass`. |
| `checks/invalid/v2-bad-phase.json` | reject | `phase` is the fixed enum `pre-build`/`build`/`post-build`. |
