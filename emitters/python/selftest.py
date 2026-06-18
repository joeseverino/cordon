#!/usr/bin/env python3
"""Self-test for the Python reference emitter.

Builds a representative argparse parser (a leaf tool and a subcommand tool),
emits each as a Cordon v4 document, and asserts the structural invariants the
schema and conformance/semantics.mjs enforce. With ``--emit`` it also prints both
documents so they can be piped through cordon's own validator:

    python3 emitters/python/selftest.py --emit | node conformance/validate.mjs -

Exit non-zero on any structural failure. No third-party deps.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cordon_emit import (  # noqa: E402
    EFFECTS,
    describe_parser,
    emit,
    set_effect,
    undeclared_effects,
)


def _leaf_parser() -> argparse.ArgumentParser:
    # Help text matches fixtures/valid/leaf-tool.json verbatim so this parser is
    # the introspect-side twin of that bash-DSL-emitted fixture — the compact
    # output must be byte-identical (see fixture_parity()).
    p = argparse.ArgumentParser(
        prog="encrypt", description="Encrypt files to your default age public key."
    )
    p.add_argument(
        "-c", "--copy", action="store_true", help="Keep the original file (encrypt a copy)"
    )
    p.add_argument(
        "-k", "--key", action="append", metavar="PATH",
        help="Add another public key as a recipient",
    )
    p.add_argument("file", nargs="+", help="File(s) to encrypt")
    return p


def _subcommand_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="hq", description="Sync vault docs into the ops app and operate the deploy."
    )
    sub = p.add_subparsers(dest="command")

    logs = sub.add_parser("logs", help="Show app container logs")
    logs.add_argument("-f", "--follow", action="store_true", help="Stream live output")
    set_effect(logs, "read", network=True)

    set_effect(sub.add_parser("restart", help="Restart the app container"), "deploy", network=True)

    create = sub.add_parser("create", help="Create or update a Project or Asset")
    create.add_argument("kind", choices=["project", "asset"], help="What to create")
    set_effect(create, "remote_write", network=True)
    return p


def _check(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL: {msg}", file=sys.stderr)
        raise SystemExit(1)


def _assert_invariants(doc: dict) -> None:
    """The cross-field rules the schema + semantics.mjs enforce, checked locally."""
    _check(doc["ok"] is True, "ok must be true")
    _check(doc["schema_version"] == 4, "schema_version must be 4")
    for key in ("name", "description", "group", "order", "effect"):
        _check(key in doc, f"missing required key {key}")
    _check(doc["effect"] in EFFECTS, f"tool effect off ladder: {doc['effect']}")

    def check_args(args: list[dict], scope: str) -> None:
        names = [a["name"] for a in args]
        _check(len(names) == len(set(names)), f"{scope}: duplicate arg names")
        flags = [f for a in args if not a["positional"] for f in a["flags"]]
        _check(len(flags) == len(set(flags)), f"{scope}: duplicate flags")
        for a in args:
            if a["positional"]:
                continue
            _check(a["name"] in a["flags"], f"{scope}/{a['name']}: name not in flags")
            if a.get("metavar") is not None or a.get("choices") is not None:
                _check(a["takes_value"], f"{scope}/{a['name']}: metavar/choices needs takes_value")

    check_args(doc["positionals"] + doc["global_options"], "/arguments")
    cmd_names = [c["name"] for c in doc["commands"]]
    _check(len(cmd_names) == len(set(cmd_names)), "duplicate command names")
    for c in doc["commands"]:
        _check(c["effect"] in EFFECTS, f"command {c['name']}: effect off ladder")
        check_args(c["args"], f"/commands/{c['name']}/args")


def build_docs() -> list[dict]:
    leaf = describe_parser(
        _leaf_parser(),
        group="Crypto",
        order=40,
        effect="local_write",
        paras=[
            "Encrypts each file in place to your configured age recipients; pass "
            "--copy to keep the original alongside the .age output."
        ],
        examples=[{"command": "encrypt notes.md", "comment": "original removed"}],
    )
    subc = describe_parser(_subcommand_parser(), group="Integrations", order=130)
    return [leaf, subc]


def fixture_parity() -> None:
    """The introspected leaf must be byte-identical to the bash-emitted fixture.

    Both emitters converge on the one contract: compared in the canonical compact
    form (the byte-deterministic shape a guard diffs), the Python introspection of
    the encrypt parser equals fixtures/valid/leaf-tool.json field-for-field.
    """
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "valid" / "leaf-tool.json"
    if not fixture_path.exists():
        print(f"skip parity: {fixture_path} not found", file=sys.stderr)
        return
    canonical = lambda d: json.dumps(d, separators=(",", ":"), sort_keys=True)  # noqa: E731
    fixture = json.loads(fixture_path.read_text())
    emitted = build_docs()[0]
    _check(
        canonical(emitted) == canonical(fixture),
        "leaf emission diverges from fixtures/valid/leaf-tool.json:\n"
        f"  fixture: {canonical(fixture)}\n  emitted: {canonical(emitted)}",
    )
    print("selftest: byte-parity with the bash-emitted leaf fixture", file=sys.stderr)


def effect_honesty() -> None:
    """Undeclared blast radius is detected, warned by default, fatal when strict.

    A leaf tool with no explicit effect, and a subcommand left un-annotated, are
    both reported by undeclared_effects(); the declared commands are not. Under
    effect_required the same condition is a hard error, while the default emit
    still produces a contract (the local fail-open posture is a choice, not a
    breakage).
    """
    # Declared commands are silent; the un-annotated one is flagged.
    p = argparse.ArgumentParser(prog="demo")
    sub = p.add_subparsers(dest="command")
    set_effect(sub.add_parser("show", help="read it"), "read")
    sub.add_parser("ship", help="unclassified on purpose")  # no set_effect
    _check(undeclared_effects(p) == ["ship"], "undeclared command not detected")

    leaf = argparse.ArgumentParser(prog="bare")  # no subcommands, no effect
    _check(undeclared_effects(leaf) == ["bare"], "undeclared leaf tool not detected")
    _check(undeclared_effects(leaf, tool_effect_override="deploy") == [],
           "explicit tool override should clear the undeclared report")

    # Strict mode is a hard error; default mode still emits.
    raised = False
    try:
        emit(p, group="X", order=1, effect_required=True)
    except SystemExit:
        raised = True
    _check(raised, "effect_required did not fail on an undeclared command")
    print("selftest: effect-honesty (warn by default, strict opt-in) passes", file=sys.stderr)


def main() -> int:
    docs = build_docs()
    for doc in docs:
        _assert_invariants(doc)
    fixture_parity()
    effect_honesty()
    # Spot-check the introspection actually captured the surface.
    leaf, subc = docs
    _check(any(o["name"] == "--key" and o.get("repeatable") for o in leaf["global_options"]),
           "append option not marked repeatable")
    _check(any(p.get("variadic") for p in leaf["positionals"]), "nargs=+ not variadic")
    restart = next(c for c in subc["commands"] if c["name"] == "restart")
    _check(restart["effect"] == "deploy" and restart.get("network") is True,
           "restart effect/network not carried from set_effect")
    print("selftest: structural invariants pass", file=sys.stderr)

    # With --emit, print the documents for the JS conformance harness to validate.
    if "--emit" in sys.argv:
        for doc in docs:
            print(json.dumps(doc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
