# cordon-emit-node

The Node **reference emitter** for Cordon. Where the Python emitter *introspects*
an `argparse` parser and the bash toolchain *declares* a surface in a DSL, an npm
repo already has its surface written down in exactly one place: `package.json`
`scripts`. So this **introspects `scripts`** — the command names, and the literal
command each one runs — and projects them to the one
[Cordon v4 contract](../../schema/cordon-v4.json). You declare nothing twice; the
contract is *derived*. Same schema, same byte-deterministic output, so a Node
emitter converges with the bash and Python ones instead of drifting.

Pure ESM, zero dependencies. **Reference it from a cordon checkout
(`$CORDON_HOME`); don't vendor it** — a copy drifts from the schema in the same repo.

## So easy — derive the surface, declare only the blast radius

A Node emitter is an executable `bin/<tool>` that reads `package.json` and calls
one function. The surface comes from `scripts`; the only thing you write by hand
is each command's **blast radius** (the one fact a script string can't tell you):

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const CORDON = process.env.CORDON_HOME ?? `${process.env.HOME}/Documents/Code/Assets/cordon`;
const { describeScripts, emitMain } = await import(`${CORDON}/emitters/node/index.mjs`);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));

emitMain(
  describeScripts(pkg, {
    group: 'Integrations',
    order: 150,
    // the one hand-fact + the allowlist of which scripts are public surface:
    effects: { build: 'local_write', deploy: 'deploy' },
    network: { deploy: true },
  }),
  { url: import.meta.url }, // roots the contract at ../contract/<name>.json
);
```

`describeScripts` reads `pkg.scripts.build` / `pkg.scripts.deploy` and emits one
command each, with `delegates` set to the **literal command the script runs** —
so whoever owns the real flags (an engine, wrangler, the framework CLI) owns
them, and a script change re-derives the contract. Scripts you don't name in
`effects` (emitter plumbing like `describe`, `build:css`) stay out. The same
`bin/<tool> --describe` convention cordon's gate already drives then covers it
unchanged — no catalog change:

```sh
bin/<tool> --describe       # print the contract (what the drift check diffs)
bin/<tool> --write          # (re)write contract/<name>.json after a scripts change
bin/<tool> --check          # exit 1 if the committed contract is stale
```

A command whose effect you omit defaults to `read` and the emitter **warns** on
stderr, so a forgotten blast radius isn't a silent fail-open. Effects ride the
[ladder](../../README.md#the-effect-ladder)
(`read < local_write < vault_write < remote_write < deploy`, plus `network` /
`interactive`).

## So powerful — zero-touch on any package.json

No emitter script needed — point the CLI at any repo's `package.json` and pipe it
into cordon's validator:

```sh
node cli.mjs ../some-repo/package.json -g Integrations -o 150 -e build=local_write,deploy=deploy
node cli.mjs ./package.json -g X -o 1 -e build=local_write \
  | node "$CORDON_HOME/conformance/validate.mjs" -
```

## Declare, when there is no parser

Some surfaces aren't npm scripts and have no parser to introspect (a hand-rolled
dispatcher, a generated CLI). For those, declare a typed spec and project it
directly — the same shape the bash DSL produces:

```js
import { renderSurface, emitMain } from `${CORDON}/emitters/node/index.mjs`;
emitMain({ name: 'x', group: 'G', order: 1, effect: 'read',
  commands: [{ name: 'go', summary: 'do it', effect: 'local_write',
    positionals: [{ name: 'target', help: 'what to act on' }] }] },
  { url: import.meta.url });
```

Prefer introspection wherever a source exists — a declared surface that
duplicates one is the drift the contract is meant to kill.

## API

| symbol | does |
|---|---|
| `describeScripts(pkg, { effects, group, order, name?, description?, paras?, network?, interactive? }) -> spec` | **introspect** — derive a surface from `package.json` scripts; `effects` is the per-script blast radius and the public-surface allowlist. |
| `emitMain(spec, { url, contractPath?, argv? })` | drop-in emitter: warn on undeclared effects, then print / `--write` / `--check` against `<url>/../contract/<name>.json`. |
| `renderSurface(spec) -> object` | the pure projection — the full `{ ok, schema_version, … }` document, keys in schema order, optional keys only when set. The **declare** path. |
| `undeclaredEffects(spec) -> string[]` | command names that defaulted their blast radius. Empty = every effect was an explicit choice. |
| `serialize(doc, { compact? }) -> string` | pretty 2-space + trailing newline (default), or the byte-minimal form a guard diffs. |
| `EFFECTS`, `SCHEMA_VERSION` | the effect ladder and the contract revision this emitter targets. |

`renderSurface` is byte-deterministic (stable key order, no timestamps) — a guard
can diff it.

## Verify

```sh
node selftest.mjs            # introspect derivation + canonical parity with the bash fixtures
node selftest.mjs --emit | node ../../conformance/validate.mjs -
```

The selftest proves convergence: the **declare** projection of a reconstructed
spec is field-for-field identical to the bash-DSL-emitted
[`fixtures/valid/leaf-tool.json`](../../fixtures/valid/leaf-tool.json) and
[`subcommands.json`](../../fixtures/valid/subcommands.json) — one schema, three
emitters, one output — and the **introspect** path derives commands straight from
a `package.json` with nothing declared twice.
