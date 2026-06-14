# Implementing a Cordon emitter

An emitter turns one tool's surface into a Cordon contract document. You don't
reuse code across languages — you converge on the [schema](../schema/cordon-v4.json)
and prove it with the [fixtures](../fixtures/). This guide is the how.

## Pick your shape

| Your runtime has… | Do this | Example |
|---|---|---|
| an introspectable parser | **introspect** it — walk the parser, project to the contract | Python `argparse`, Go `cobra`, Rust `clap` |
| no introspectable parser | **declare** a tiny DSL, render the contract from it | POSIX shell, Make |

Either way the *output* is identical. The choice is only about where the
declaration lives — read from a parser you already have, or a DSL you add.

## The required shape

Emit one JSON object per tool with every required key present (see the schema).
Notes that trip people up:

- **`effect` is required on the tool and on every command.** Require authors to
  declare it explicitly, including `read`; never infer a safety classification.
  This is the whole point — see below.
- **`additionalProperties: false` everywhere.** Emit *only* the keys the schema
  names. Don't leak runtime-specific fields (a real bug we've hit: argparse's
  `type`/`default` are not in the contract — drop them).
- **`network` / `interactive` are emitted only when `true`** (they're `const:
  true`), to keep the document lean. `network` describes the requested
  operation reaching a remote system, not dependency installation or a
  package-manager cache miss.
- **Options are always `required: false`** in the contract; model requiredness
  only on positionals. (The schema pins `option.required` to `false`.)
- **`paras` is one logical paragraph per array entry, unwrapped** — never a
  hard-wrapped source line. Every renderer reflows to its own width, so don't
  bake in line breaks.
- **Deterministic output.** No timestamps, stable key order — so a guard can
  diff two emissions.

## Declare the effect

`effect` is the signal a consumer risk-gates on. Declare it explicitly wherever
you declare the tool or command, on the ladder `read → local_write → vault_write
→ remote_write → deploy`. Tag `network` when the requested operation reaches off-box,
`interactive` when it blocks on a TTY. If you can't say what a command does to
the world, you can't safely let an agent run it — so make this non-optional in
your emitter.

## Leaf-tool invocation

Cordon describes a surface; it does not prescribe what a bare invocation does.
An emitter may show help, run with defaults, or report a usage error. The
emitter must keep that behavior consistent with required positionals and its
human help. The reference Bash emitter used by `tools` shows the main help screen
when a leaf tool is invoked with no arguments.

## Runtime and dependency metadata

Schema v4 has no structured dependency field. Pin versions in the
implementation and describe important runtime requirements in existing prose or
implementation documentation. Do not add an ad hoc key: v4 uses
`additionalProperties: false`, so even an optional field would break existing
validators. Structured dependency metadata requires a future schema version.

## The runtime gate

The contract carries the signal; the *consumer* enforces policy. The reference
behavior (from the `tools` emitter) for the top of the ladder:

> Before running a `deploy`, require explicit confirmation. At a TTY, prompt
> `[y/N]`. Non-interactive, **fail closed** unless an explicit bypass env var is
> set — so a deploy never happens by accident, by a script, or by an agent.

Derive the gate from the *same* declaration that feeds help and JSON, so the
warning can never disagree with the contract. Don't hand-wire a prompt per
command.

## Validate as you build

```bash
your-tool --describe | node ../conformance/validate.mjs -
```

The harness applies both JSON Schema validation and the cross-field semantic
rules in `conformance/semantics.mjs`. Reuse that harness instead of maintaining
a private approximation when Cordon is available.

Then add your tool to [`EMITTERS.md`](EMITTERS.md). If a fixture blocks you,
that's the spec doing its job — fix the emitter, not the fixture.
