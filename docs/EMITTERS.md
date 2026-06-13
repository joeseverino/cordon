# Known emitters

Implementations that produce Cordon-conformant contracts. Each validates against
[`schema/cordon-v4.json`](../schema/cordon-v4.json).

| Emitter | Language | Shape | How |
|---|---|---|---|
| `severino-tools` | Bash | **declare** | A `describe_spec()` DSL (`desc_cmd`, `desc_opt`, `desc_effect`, …) rendered to both `-h` text and the JSON contract by two pure renderers. Also hosts the reference runtime deploy gate. |
| `severino-vault-mcp` | Python | **introspect** | Walks its `argparse` parser and projects it to the contract — `--help` made machine-readable, so it can't drift from the parser. |

Adding one? Implement against the [fixtures](../fixtures/), validate your
`--describe` output, and open a PR adding a row here.

## Federation

A consumer can fold multiple emitters into one document (an aggregator that
collects each tool's output, plus sibling repos' emitters) and validate every
member against this one schema. That's the cross-repo drift guard: independent
codebases, in different languages, checked against a single contract.
