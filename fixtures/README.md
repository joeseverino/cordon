# Conformance fixtures

Language-agnostic test vectors. Any Cordon emitter (in any language) is correct
when its output validates the way these say it should — point your validator at
the matching schema and run [`conformance/validate.mjs`](../conformance/validate.mjs).
The harness picks the schema by document shape: `commands[]` → the
command-surface contract (`schema/cordon-v4.json`); `checks[]` → the checks
verdict (`schema/cordon-checks-v1.json`).

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

## Checks verdict — `schema/cordon-checks-v1.json`

The repo-level sibling. Where the command-surface contract answers *"what does
running this command cost?"*, the verdict answers *"is this repo shippable, and
what fixes each failure?"* — the machine-readable output of
[`checks/run.mjs --json`](../checks/run.mjs). `durationMs` is the one runtime
field (a verdict is a report, not a static description); everything else is
deterministic — checks ride in registry order and `failed[]` is derived.

| Fixture | Must | Rule it pins |
|---|---|---|
| `checks/valid/all-pass.json` | pass | A green verdict: `ok: true`, empty `failed[]`, `report: null`, a `pass` check carrying its `effect`. |
| `checks/valid/with-failure.json` | pass | A red verdict across the ladder: a `fail` with `fix`+`rerun`, a `skip`, and a `remote_write` check with `network`/`interactive`. |
| `checks/invalid/missing-fix-on-failure.json` | reject | A `fail` check must carry remediation — `fix` **and** `rerun` are required when `status` is `fail`. |
| `checks/invalid/bad-status.json` | reject | `status` must be `pass`/`fail`/`skip`. |
| `checks/invalid/bad-effect.json` | reject | A check's `effect` must be one of the fixed ladder values. |
| `checks/invalid/extra-key.json` | reject | `additionalProperties: false` — no smuggling per-check fields. |
