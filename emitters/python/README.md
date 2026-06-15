# cordon-emit (Python)

The Python **reference emitter** for Cordon. Where the bash toolchain *declares*
a surface in a DSL, a Python CLI already has an `argparse` parser — so you don't
declare anything twice: this **introspects** that parser and projects it to the
one [Cordon v4 contract](../../schema/cordon-v4.json). `--describe` becomes a
machine-readable view of the exact parser that produces `--help`, so the two
can't drift.

Pure stdlib, zero dependencies. **Reference it from a cordon checkout
(`$CORDON_HOME`); don't vendor it** — a copy drifts from the schema in the same
repo.

## So easy — one line

Add the parser you already build, then one line. That's the whole integration:

```python
import argparse
from cordon_emit import describe_main, set_effect

def build_parser():
    p = argparse.ArgumentParser(prog="hq", description="Operate the deploy.")
    sub = p.add_subparsers(dest="command")

    logs = sub.add_parser("logs", help="Show app container logs")
    logs.add_argument("-f", "--follow", action="store_true", help="Stream live output")
    set_effect(logs, "read", network=True)

    set_effect(sub.add_parser("restart", help="Restart the app"), "deploy", network=True)
    return p

def main():
    parser = build_parser()
    describe_main(parser, group="Integrations", order=130)  # ← handles --describe / --pretty, exits
    args = parser.parse_args()
    ...
```

Now `hq --describe` emits a valid contract and `hq --help` reads from the same
parser. The only thing you add by hand is the one fact a parser can't tell you:
each command's **blast radius**, via `set_effect()` on the
[effect ladder](../../README.md#the-effect-ladder)
(`read < local_write < vault_write < remote_write < deploy`, plus `network` /
`interactive`). Unannotated commands default to `read`.

## So powerful — zero-touch on any parser

Don't even need to edit the tool. Point the module at any importable factory that
returns an `ArgumentParser` (`module:attribute`) and pipe it straight into
cordon's validator:

```sh
python -m cordon_emit myapp.cli:build_parser -g Integrations -o 130
python -m cordon_emit myapp.cli:build_parser -g X -o 1 \
  | node "$CORDON_HOME/conformance/validate.mjs" -      # exit 0 = conformant
```

That's a contract — and a conformance check — for an existing Python CLI with no
code change.

## API

| symbol | does |
|---|---|
| `describe_main(parser, *, group, order, **kw)` | drop-in `--describe` handler: emit + `SystemExit(0)` when requested, else return. The one-liner. |
| `describe_parser(parser, *, group, order, effect=None, paras=None, examples=None) -> dict` | the pure projection — returns the full `{ok, schema_version, …}` document. |
| `set_effect(parser, effect, *, network=False, interactive=False)` | annotate a (sub)parser's blast radius; returns it so it nests in `add_parser(...)`. |
| `emit(parser, *, pretty=False, **kw)` | `print(json.dumps(describe_parser(...)))`; compact by default, `--pretty` indents. |

`describe_parser` returns the canonical, byte-deterministic document (no
timestamps, stable order) — a guard can diff it.

## Install

Reference in place (preferred):

```python
import sys; sys.path.insert(0, f"{os.environ['CORDON_HOME']}/emitters/python")
```

or install it:

```sh
pip install "$CORDON_HOME/emitters/python"
```

## Verify

```sh
python3 emitters/python/selftest.py            # structural + byte-parity with the bash leaf fixture
python3 emitters/python/selftest.py --emit | node ../../conformance/validate.mjs -
```

The selftest also proves convergence: introspecting an `encrypt`-shaped parser
yields a contract **byte-identical** to the bash-DSL-emitted
[`fixtures/valid/leaf-tool.json`](../../fixtures/valid/leaf-tool.json) — same
schema, two emitters, one output.
