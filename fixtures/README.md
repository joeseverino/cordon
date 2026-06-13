# Conformance fixtures

Language-agnostic test vectors. Any Cordon emitter (in any language) is correct
when its output validates the way these say it should — point your validator at
`schema/cordon-v4.json` and run [`conformance/validate.mjs`](../conformance/validate.mjs).

- **`valid/`** — documents a conformant emitter may produce. Must **pass**.
- **`invalid/`** — documents that must be **rejected**. Each isolates one rule.

| Fixture | Must | Rule it pins |
|---|---|---|
| `valid/leaf-tool.json` | pass | A leaf tool: tool-level `effect`, global options (incl. a repeatable, value-taking one), a variadic positional, empty `commands`. |
| `valid/subcommands.json` | pass | A command tool: per-command `effect` across the ladder (`read`/`deploy`/`remote_write`), `network`, `choices`, `delegates`. |
| `invalid/missing-effect.json` | reject | Every command must declare a blast radius (`effect` is required). |
| `invalid/bad-effect.json` | reject | `effect` must be one of the fixed ladder values. |
| `invalid/extra-key.json` | reject | `additionalProperties: false` — no smuggling tool-specific fields. |
