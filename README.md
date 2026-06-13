# Cordon

**A language-agnostic command-surface contract.** Declare a command-line tool
once; render every view from that one declaration — human help, shell
completions, docs, and a machine-readable spec — and have every command carry
its **blast radius**, so an automated agent can risk-gate *before* it acts.

> Emit once, render many. One declaration per tool; every surface derived from
> it, so they can't drift — and a deploy can't be mistaken for a read.

- **Schema:** [`schema/cordon-v4.json`](schema/cordon-v4.json) · canonical `$id` `https://jseverino.com/schemas/cordon-v4.json`
- **Conformance:** [`fixtures/`](fixtures/) + [`conformance/validate.mjs`](conformance/validate.mjs)
- **Implementations:** [`docs/EMITTERS.md`](docs/EMITTERS.md)

---

## Why this exists

Most "describe your CLI" formats answer *what flags exist*. They don't answer
the question an autonomous agent actually needs: **what happens if I run this?**
A `status` read and a `ship` that deploys to production look identical at the
flag level. Cordon makes the answer a first-class, required field.

Two ideas, working together:

1. **Emit once, render many.** A tool declares its surface in exactly one place.
   Two pure renderers turn that into the human help *and* the machine JSON, so
   there is no prose to parse and the views can't disagree. Generated
   completions, READMEs, and TUIs all fall out of the same source.

2. **Blast radius as a required signal.** Every command (and leaf tool) declares
   an `effect` on a fixed, escalating ladder. It is the one fact a caller can't
   infer from flags — and the hook a runtime gate or an AI session uses to stop
   before doing something irreversible.

## The effect ladder

```
read  <  local_write  <  vault_write  <  remote_write  <  deploy
```

| effect | means |
|---|---|
| `read` | observes only; no mutation |
| `local_write` | writes to the local filesystem |
| `vault_write` | mutates a system of record / knowledge store |
| `remote_write` | reaches off-box to mutate a remote (API / SSH) |
| `deploy` | ships to production — the irreversible end of the ladder |

Plus two optional boolean tags, emitted only when `true`:

- **`network`** — touches a remote / API / SSH (not derivable from the class: a
  `read` can be networked, a `local_write` can be offline).
- **`interactive`** — blocks on a TTY (a prompt, `ssh -t`, a full-screen UI).

**The gate principle.** A consumer is expected to risk-gate on `effect` — e.g.
confirm before a `deploy`, fail closed when non-interactive. The signal lives in
the contract; the policy lives in the consumer. (Reference gate:
[`docs/IMPLEMENTERS.md`](docs/IMPLEMENTERS.md#the-runtime-gate).)

## The contract

A single JSON object per tool. Required: `ok`, `schema_version`, `name`,
`description`, `group`, `order`, `effect`, `global_options`, `positionals`,
`paras`, `examples`, `commands`. The document is `additionalProperties: false`
and byte-deterministic (no timestamps), so a guard can diff it.

```jsonc
{ "ok": true, "schema_version": 4, "name": "hq", "description": "…",
  "group": "Integrations", "order": 130,
  "effect": "read",                          // tool-level (meaningful for leaf tools)
  "global_options": [ /* <option> */ ],
  "positionals":    [ /* <positional> */ ],
  "paras":     [ "one logical paragraph per entry, unwrapped" ],
  "examples":  [ { "command": "…", "comment": "…" } ],
  "commands":  [ { "name": "restart", "summary": "…", "args": [ /* … */ ],
                   "effect": "deploy", "network": true,
                   "paras": [], "examples": [],
                   "delegates": "owner of these flags, if elsewhere" } ] }
```

See [`schema/cordon-v4.json`](schema/cordon-v4.json) for the full definition of
`<option>` / `<positional>` / `<example>` / `<command>`.

## Conformance

An emitter conforms when its output validates against the schema and behaves the
way the fixtures specify:

```bash
npm ci
node conformance/validate.mjs                 # run the fixture suite
node conformance/validate.mjs path/to/out.json  # validate one document
some-tool --describe | node conformance/validate.mjs -   # validate stdin
```

`fixtures/valid/` must pass; `fixtures/invalid/` must be rejected, each isolating
one rule. They are the contract's executable definition — implement against
them in any language.

## Writing an emitter

You don't share code across languages — you converge on this output. Two honest
shapes, depending on what your runtime gives you:

- **Introspect** an existing structured parser (e.g. Python `argparse`, Go
  `cobra`) and project it to the contract.
- **Declare** a small DSL when the runtime has no introspectable parser (e.g.
  shell), and render the contract from that declaration.

Full guide: [`docs/IMPLEMENTERS.md`](docs/IMPLEMENTERS.md). Known emitters:
[`docs/EMITTERS.md`](docs/EMITTERS.md).

## Versioning

One version axis: the on-wire `schema_version` integer. The schema URL tracks it
(`cordon-v4.json` ↔ `schema_version: 4`); a future breaking shape ships as
`cordon-v5.json` and old consumers keep validating against v4. The name *Cordon*
is the standard; the number is the contract revision.

## License

[MIT](LICENSE) © Joe Severino
