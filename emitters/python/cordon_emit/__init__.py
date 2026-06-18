"""Cordon reference emitter for Python — introspect an argparse parser.

The Python sibling of the tools repo's ``lib/describe.sh``: where bash *declares*
a surface in a small DSL, a Python CLI *introspects* the ``argparse`` parser it
already built and projects it to the one Cordon v4 contract. Same output, same
schema, so the two converge instead of drifting — and ``--describe`` becomes a
machine-readable view of the exact parser that produces ``--help``.

Pure and dependency-free: :func:`describe_parser` takes an
:class:`argparse.ArgumentParser` and returns a JSON-serializable dict that
validates against ``schema/cordon-v4.json``. It reads documented argparse
internals (``_actions``, ``_SubParsersAction``, ``_choices_actions``) — the
stable, widely-used way to walk a parser without re-declaring its shape.

Reference, don't vendor: import this from a checkout of cordon (``$CORDON_HOME``)
or ``pip install $CORDON_HOME/emitters/python``. A copied emitter drifts; this
one tracks the schema in the same repo.

Typical use in a CLI's entry point::

    import argparse, json
    from cordon_emit import describe_parser, set_effect

    def build_parser():
        p = argparse.ArgumentParser(prog="hq", description="Operate the deploy.")
        sub = p.add_subparsers(dest="command")
        restart = sub.add_parser("restart", help="Restart the app container")
        set_effect(restart, "deploy", network=True)
        return p

    parser = build_parser()
    if "--describe" in sys.argv:
        print(json.dumps(describe_parser(parser, group="Integrations", order=130)))
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

# Contract revision this emitter targets. Bump only in lockstep with a new
# schema/cordon-vN.json — adding a field to v4 is itself a wire-format change.
SCHEMA_VERSION = 4

# The escalating blast-radius ladder. The emitter does not police which effect a
# command declares (that is the author's honesty), but it rejects a value that
# isn't on the ladder so a typo can't silently weaken a gate.
EFFECTS = ("read", "local_write", "vault_write", "remote_write", "deploy")

# argparse nargs values that make a positional non-required / variadic.
_OPTIONAL_NARGS = {"?", "*", argparse.REMAINDER}
_VARIADIC_NARGS = {"*", "+", argparse.REMAINDER}

# Where set_effect() stashes the blast-radius signal on a parser/subparser. The
# emitter is the only reader; the namespaced prefix avoids colliding with
# argparse's own attributes or an app's.
_EFFECT_ATTR = "_cordon_effect"
_NETWORK_ATTR = "_cordon_network"
_INTERACTIVE_ATTR = "_cordon_interactive"


def set_effect(
    parser: argparse.ArgumentParser,
    effect: str,
    *,
    network: bool = False,
    interactive: bool = False,
) -> argparse.ArgumentParser:
    """Annotate a parser or subparser with its blast radius, then return it.

    ``effect`` is one of :data:`EFFECTS`. ``network`` marks an operation that
    itself reaches a remote / API / SSH endpoint; ``interactive`` marks one that
    blocks on a TTY. Both are emitted only when true. Call this on the subparser
    a command was added to (``set_effect(sub.add_parser("ship"), "deploy")``);
    unannotated commands default to ``read``.
    """
    if effect not in EFFECTS:
        raise ValueError(f"effect {effect!r} not on the ladder {EFFECTS}")
    setattr(parser, _EFFECT_ATTR, effect)
    if network:
        setattr(parser, _NETWORK_ATTR, True)
    if interactive:
        setattr(parser, _INTERACTIVE_ATTR, True)
    return parser


def _effect_fields(
    parser: argparse.ArgumentParser,
    *,
    override: str | None = None,
    default: str = "read",
) -> dict[str, Any]:
    """The effect triple for a parser: always ``effect``; the tags only when set.

    Precedence: an explicit ``override`` wins, else a :func:`set_effect`
    annotation, else ``default``. The ``network`` / ``interactive`` tags always
    come from the annotation and are emitted only when true.
    """
    effect = override or getattr(parser, _EFFECT_ATTR, None) or default
    if effect not in EFFECTS:
        raise ValueError(f"effect {effect!r} not on the ladder {EFFECTS}")
    fields: dict[str, Any] = {"effect": effect}
    if getattr(parser, _NETWORK_ATTR, False):
        fields["network"] = True
    if getattr(parser, _INTERACTIVE_ATTR, False):
        fields["interactive"] = True
    return fields


def _option_name(option_strings: list[str]) -> str:
    """The canonical name for an option: its first long (--) flag, else the first."""
    return next((f for f in option_strings if f.startswith("--")), option_strings[0])


def _describe_arg(action: argparse.Action) -> dict[str, Any]:
    """One option/positional as a v4 contract entry.

    Emits only schema-allowed keys (the contract is ``additionalProperties:
    false``): name, positional, required, help, and — for options — flags /
    takes_value / metavar; choices / variadic / repeatable ride along when
    present. No argparse-only extras (type, default) leak in.
    """
    positional = not action.option_strings
    entry: dict[str, Any] = {
        # Name an option by its long (--) flag, matching the bash DSL emitter so
        # a federated document (bash + Python folded together) is homogeneous;
        # fall back to the first flag, then the dest for positionals.
        "name": _option_name(action.option_strings) if action.option_strings else action.dest,
        "positional": positional,
        # Positionals carry their real requiredness; the schema models an option
        # as always-optional (required const false there), so options pin False.
        "required": (action.nargs not in _OPTIONAL_NARGS) if positional else False,
        "help": action.help or "",
    }
    if positional:
        if action.nargs in _VARIADIC_NARGS:
            entry["variadic"] = True
    else:
        entry["flags"] = list(action.option_strings)
        # store_true / store_false (and the count action) are switches that
        # consume no value.
        takes_value = not isinstance(
            action,
            argparse._StoreTrueAction | argparse._StoreFalseAction | argparse._CountAction,
        )
        entry["takes_value"] = takes_value
        if takes_value and action.metavar:
            entry["metavar"] = action.metavar
        # append-action options accept the flag more than once.
        if isinstance(action, argparse._AppendAction | argparse._AppendConstAction):
            entry["repeatable"] = True
    if action.choices:
        entry["choices"] = list(action.choices)
    return entry


def describe_parser(
    parser: argparse.ArgumentParser,
    *,
    group: str,
    order: int,
    effect: str | None = None,
    paras: list[str] | None = None,
    examples: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Project an argparse parser to a complete Cordon v4 document.

    Returns the full ``{ok, schema_version, ...}`` envelope — directly
    JSON-serializable and ready to validate against ``schema/cordon-v4.json``.

    ``group`` / ``order`` are the tool's inventory coordinates (``order`` must be
    unique within an aggregate). ``effect`` sets the tool-level blast radius
    (default ``read``, or whatever :func:`set_effect` annotated on ``parser``);
    for a subcommand tool the per-command effects carry the real signal.
    ``paras`` / ``examples`` are optional tool-level prose and ``{command,
    comment}`` examples; argparse has no concept of them, so they default empty.
    """
    subparsers_action = next(
        (a for a in parser._actions if isinstance(a, argparse._SubParsersAction)),
        None,
    )

    global_options = [
        _describe_arg(a)
        for a in parser._actions
        if a.option_strings and not isinstance(a, argparse._HelpAction)
    ]
    positionals = [
        _describe_arg(a)
        for a in parser._actions
        if not a.option_strings and not isinstance(a, argparse._SubParsersAction)
    ]

    commands: list[dict[str, Any]] = []
    if subparsers_action is not None:
        summaries = {
            choice.dest: (choice.help or "")
            for choice in subparsers_action._choices_actions
        }
        for name, subparser in subparsers_action.choices.items():
            args = [
                _describe_arg(action)
                for action in subparser._actions
                if not isinstance(action, argparse._HelpAction)
            ]
            commands.append(
                {
                    "name": name,
                    "summary": summaries.get(name, ""),
                    "args": args,
                    # Per-command blast radius: read by default; writers annotate
                    # the subparser with set_effect().
                    **_effect_fields(subparser),
                    # argparse has no per-command prose/examples; emit empty
                    # arrays so the shape matches the schema exactly.
                    "paras": [],
                    "examples": [],
                }
            )

    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "name": parser.prog,
        "description": parser.description or "",
        "group": group,
        "order": order,
        # Tool-level blast radius. The explicit arg wins; otherwise a set_effect
        # annotation on the root parser; otherwise read.
        **_effect_fields(parser, override=effect),
        "global_options": global_options,
        "positionals": positionals,
        "paras": list(paras or []),
        "examples": list(examples or []),
        "commands": commands,
    }


def undeclared_effects(
    parser: argparse.ArgumentParser, *, tool_effect_override: str | None = None
) -> list[str]:
    """Surfaces whose blast radius fell through to the default instead of a choice.

    An effect is *declared* when :func:`set_effect` annotated the (sub)parser or,
    at tool level, when an explicit ``effect`` override was passed. A surface that
    relied on the ``read`` default is *undeclared* — it carries no signal that the
    author considered its blast radius, which is the silent fail-open the contract
    is meant to avoid.

    For a tool with subcommands, the tool-level effect defaulting to ``read`` is
    expected (the per-command effects carry the signal), so only undeclared
    *commands* are reported. For a leaf tool, the tool itself is reported. Returns
    surface names (command names, or the tool ``prog`` for a leaf); empty means
    every blast radius on the surface was an explicit choice.
    """
    subparsers_action = next(
        (a for a in parser._actions if isinstance(a, argparse._SubParsersAction)),
        None,
    )
    if subparsers_action is not None:
        return [
            name
            for name, sub in subparsers_action.choices.items()
            if getattr(sub, _EFFECT_ATTR, None) is None
        ]
    if tool_effect_override is None and getattr(parser, _EFFECT_ATTR, None) is None:
        return [parser.prog]
    return []


def _report_undeclared(
    parser: argparse.ArgumentParser,
    *,
    tool_effect_override: str | None,
    effect_required: bool,
) -> None:
    """Warn (or, under ``effect_required``, fail) on surfaces that defaulted to read.

    The default posture is a stderr warning that lists the undeclared surfaces and
    leaves the contract emitting normally — nothing breaks, an unannotated command
    still runs as ``read``. ``effect_required`` (the strict, multi-tenant posture)
    turns the same condition into a hard error before the contract is printed.
    """
    names = undeclared_effects(parser, tool_effect_override=tool_effect_override)
    if not names:
        return
    listed = ", ".join(names)
    if effect_required:
        raise SystemExit(
            f"cordon: {len(names)} surface(s) have no declared effect: {listed}. "
            "effect_required is on, so an unclassified surface is a hard error. "
            "Declare each with set_effect(...) or pass --effect."
        )
    print(
        f"cordon: warning: {len(names)} surface(s) default to 'read' with no "
        f"declared effect (a silent fail-open): {listed}. Declare with "
        "set_effect(...) or pass --effect to make the blast radius an explicit choice.",
        file=sys.stderr,
    )


def emit(
    parser: argparse.ArgumentParser,
    *,
    pretty: bool = False,
    effect_required: bool = False,
    **kwargs: Any,
) -> None:
    """Print ``describe_parser(parser, **kwargs)`` as JSON to stdout.

    ``pretty`` indents for a human; the default is the compact, byte-deterministic
    form a guard diffs. ``kwargs`` are :func:`describe_parser`'s (``group``,
    ``order``, ``effect``, ``paras``, ``examples``).

    Before printing, any surface that defaulted its blast radius instead of
    declaring it is reported: a stderr warning by default, or a hard error when
    ``effect_required`` is set (see :func:`_report_undeclared`).
    """
    _report_undeclared(
        parser, tool_effect_override=kwargs.get("effect"), effect_required=effect_required
    )
    doc = describe_parser(parser, **kwargs)
    indent = 2 if pretty else None
    print(json.dumps(doc, indent=indent, sort_keys=False))


def describe_main(
    parser: argparse.ArgumentParser,
    *,
    group: str,
    order: int,
    argv: list[str] | None = None,
    **kwargs: Any,
) -> None:
    """Drop-in ``--describe`` handler — the one line that makes a CLI emit-once.

    Call it right after building the parser and before ``parse_args``::

        parser = build_parser()
        describe_main(parser, group="Integrations", order=130)  # handles --describe
        args = parser.parse_args()

    If ``--describe`` is in ``argv`` (default ``sys.argv[1:]``) it prints the
    contract (``--pretty`` indents) and exits 0; otherwise it returns and the CLI
    runs normally. Mirrors the bash emitter's ``desc_help_intercept "$@"``.
    """
    argv = sys.argv[1:] if argv is None else argv
    if "--describe" in argv:
        emit(
            parser,
            group=group,
            order=order,
            pretty="--pretty" in argv,
            effect_required="--effect-required" in argv,
            **kwargs,
        )
        raise SystemExit(0)


__all__ = [
    "describe_parser",
    "describe_main",
    "emit",
    "set_effect",
    "undeclared_effects",
    "SCHEMA_VERSION",
    "EFFECTS",
]
