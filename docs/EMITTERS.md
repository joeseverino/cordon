# Known emitters

Implementations that produce Cordon-conformant contracts. Each validates against
[`schema/cordon-v4.json`](../schema/cordon-v4.json).

## Reference emitters (in this repo)

Drop-in, dependency-free emitters you reference from a cordon checkout
(`$CORDON_HOME`) rather than reimplement. Reference, don't vendor — they track
the schema in the same repo.

| Emitter | Language | Shape | How |
|---|---|---|---|
| [`emitters/python`](../emitters/python/) (`cordon-emit`) | Python | **introspect** | One line — `describe_main(parser, group=…, order=…)` — projects an existing `argparse` parser to the contract; `set_effect()` declares each command's blast radius. Undeclared commands default to `read` but the emitter warns, and `--effect-required` makes an undeclared command fatal (strict posture). Zero-touch path: `python -m cordon_emit module:factory`. Proven byte-identical to the bash leaf fixture by its selftest. |
| [`emitters/node`](../emitters/node/) (`cordon-emit-node`) | Node / JS | **introspect** (+ declare) | An npm repo's surface lives in one place — `package.json` `scripts` — so `describeScripts(pkg, { effects, group, order })` derives the commands (names + the literal command each delegates to) from there; you declare only each command's blast radius. The emitter is an executable `bin/<tool>` answering `--describe`/`--write`/`--check`, so cordon's existing `conformance` + `drift` checks cover it with no catalog change. `renderSurface(spec)` is the declare fallback for surfaces with no parser. Zero-touch path: `node cli.mjs package.json -e build=local_write`. Selftest proves both: introspect derivation, and declare-projection byte-identical to **both** bash fixtures (`leaf-tool`, `subcommands`). |

## In-the-wild emitters

| Emitter | Language | Shape | How |
|---|---|---|---|
| [`severino-tools`](https://github.com/joeseverino/tools) | Bash | **declare** | A `describe_spec()` DSL (`desc_cmd`, `desc_opt`, `desc_effect`, …) rendered to both `-h` text and the JSON contract by two pure renderers. Also hosts the reference runtime deploy gate. Implementation notes: [`docs/command-surface-contract.md`](https://github.com/joeseverino/tools/blob/main/docs/command-surface-contract.md). |
| [`severino-vault-mcp`](https://github.com/joeseverino/severino-vault-mcp) | Python | **introspect** | Walks its `argparse` parser and projects it to the contract — `--help` made machine-readable, so it can't drift from the parser. Emitter: [`cli_introspect.py`](https://github.com/joeseverino/severino-vault-mcp/blob/main/src/severino_vault_mcp/cli_introspect.py) (candidate to converge onto the `emitters/python` reference). |
| [`severino-brand`](https://github.com/joeseverino/severino-brand) | Node / JS | **introspect** | The first in-the-wild Node emitter — consumes `emitters/node`. `bin/brand` derives its `build`/`kit` surface from `package.json` scripts (each `delegates` to the `branding-engine` command it runs) and declares only their `local_write` blast radius. `tools/bin/brand` launches them and derives the surface from `contract/brand.json` rather than redeclaring it. |

Adding one? Implement against the [fixtures](../fixtures/), validate your
`--describe` output, and open a PR adding a row here.

## Federation

A consumer can fold multiple emitters into one document (an aggregator that
collects each tool's output, plus sibling repos' emitters) and validate every
member against this one schema. That's the cross-repo drift guard: independent
codebases, in different languages, checked against a single contract.
