"""Zero-touch emitter: project any importable argparse parser to a contract.

Point it at a factory that returns an ``argparse.ArgumentParser`` — no edit to
the target CLI required — and it prints the Cordon v4 document. Pipe it straight
into cordon's validator to prove conformance:

    python -m cordon_emit myapp.cli:build_parser -g Integrations -o 130
    python -m cordon_emit myapp.cli:build_parser -g X -o 1 | \\
        node "$CORDON_HOME/conformance/validate.mjs" -

The target is ``module:attribute`` where ``attribute`` is either a zero-arg
callable returning a parser, or a parser object itself.
"""

from __future__ import annotations

import argparse
import importlib
import sys
from typing import Any

from . import emit


def _load_parser(target: str) -> argparse.ArgumentParser:
    if ":" not in target:
        raise SystemExit(f"target must be 'module:attribute', got {target!r}")
    module_name, attr = target.split(":", 1)
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        raise SystemExit(f"cannot import {module_name!r}: {exc}") from exc
    obj: Any = getattr(module, attr, None)
    if obj is None:
        raise SystemExit(f"{module_name!r} has no attribute {attr!r}")
    parser = obj() if callable(obj) else obj
    if not isinstance(parser, argparse.ArgumentParser):
        raise SystemExit(f"{target} did not yield an argparse.ArgumentParser")
    return parser


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m cordon_emit",
        description="Emit a Cordon v4 contract from any importable argparse parser.",
    )
    ap.add_argument("target", help="module:attribute yielding an ArgumentParser")
    ap.add_argument("-g", "--group", required=True, help="inventory group")
    ap.add_argument("-o", "--order", required=True, type=int, help="inventory order")
    ap.add_argument("-e", "--effect", help="tool-level effect (default: read)")
    ap.add_argument("--pretty", action="store_true", help="indent the JSON")
    args = ap.parse_args(sys.argv[1:] if argv is None else argv)

    parser = _load_parser(args.target)
    emit(parser, group=args.group, order=args.order, effect=args.effect, pretty=args.pretty)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
