# Cordon checks

Portable **repo-level invariant checks** — the sibling of `conformance/`. Where
conformance answers *"does this command surface match the contract?"*, checks
answer *"does this repository satisfy the standing invariants?"* — no secrets or
build output tracked, GitHub Actions pinned, no ambiguous module siblings, and so
on. Both are the same idea cordon exists for: **a guarantee declared once,
centrally, that a repo *references* instead of reimplementing** — so it can't
drift, and an agent can read the verdict before it acts.

```
checks/
├── run.mjs            the runner — collect-all, human + --json, writes a report
├── registry.mjs       the inventory: which checks exist (data + module refs)
└── lib/<id>.mjs       one check each: { id, name, effect, fix, gates, run(ctx) }
```

## checks vs tests — the boundary

> A **check** asserts a *general invariant about an artifact* (the repo, its
> build output, its config). The rule is universal, so it's portable → it lives
> here and every repo references it.
>
> A **test** exercises the *behavior of code a specific repo wrote* (a parser, an
> API handler, a rendered page). It's coupled to its subject by definition → it
> stays in that repo's `tests/`.

If a check needs to know what *your* code does, it's a test, not a check. Keep it
home and register it into your own gate; don't push it up to cordon.

## Gates (and why there are no phases)

Each check declares the `gates` it belongs to, and a gate is just
`checksFor(name)` over the registry — so **completeness is structural**: register
a check and every gate that claims it runs it, with no second edit. cordon ships
one gate, `check` (what `checks/run.mjs` runs); a consumer is free to define its
own named gates (a fast local gate, a full release gate) by filtering on its own
gate names over the same registry.

**Phases** — ordering checks around a build, skipping post-build work when the
build fails — are a *consumer* orchestration concern. cordon builds nothing, so
it imposes no phase model and the verdict schema carries none. The one shipped
check that runs a command, `idempotence`, simply declares `effect: local_write`
so a consumer can order or gate it as it likes.

## Run it

```sh
node checks/run.mjs                 # all checks over the cwd (human output)
node checks/run.mjs --root <dir>    # over another repo
node checks/run.mjs --only <id>     # one check (this is the printed rerun line)
node checks/run.mjs --json          # the agent/CI contract (sole stdout)
node checks/run.mjs --list          # available checks
```

A consuming repo references this the same way it references the conformance
harness — by `$CORDON_HOME`, never vendored:

```sh
node "$CORDON_HOME/checks/run.mjs" --root "$PWD"
```

## The `--json` contract

The repo-level analog of `--describe`: a machine-readable verdict an agent or CI
acts on without parsing prose. `ok` is the gate; each failed check carries its
own `fix` and the exact `rerun` command.

```json
{
  "ok": false,
  "schema_version": 1,
  "failed": ["repository-policy"],
  "report": ".cordon-checks-report.md",
  "checks": [
    { "id": "repository-policy", "name": "Repository Policy", "status": "fail",
      "durationMs": 25, "effect": "read", "fix": "…", "rerun": "node checks/run.mjs --only repository-policy" }
  ]
}
```

This verdict is a **versioned contract** — [`schema/cordon-checks-v1.json`](../schema/cordon-checks-v1.json),
the repo-level sibling of the command-surface schema — and `checks/run.mjs --json`
is its reference emitter, validated by [`conformance/validate.mjs`](../conformance/validate.mjs)
(the harness picks the schema by shape: a verdict has `checks[]`). The schema
enforces the two signals an agent needs: a `fail` check **must** carry `fix` +
`rerun`, and every check carries its own `effect`.

`effect` is cordon's blast-radius ladder applied to the check itself — the cost
of *producing* the verdict, in the same vocabulary a command's `--describe` uses.
A `read` check (e.g. `repository-policy`) is safe to run anywhere; a check that
reaches off-box rides `network: true` (and `interactive: true` if it blocks on a
TTY), emitted only when true, exactly as on the command surface. So one agent
reads both "what does this command cost?" and "what does running this check
cost?" in one language.

`status` is `pass | fail | skip`. A check returns `skip` when the thing it
inspects is absent (no `.nvmrc`, not a git repo) — **fail-soft**, exactly like
the conformance check that *warns* when cordon isn't reachable. Zero config still
runs every universal rule.

## Per-repo configuration

Optional `cordon.checks.json` at the repo root, keyed by check id; each object is
handed to that check as `ctx.config`, merged over the check's own defaults:

```json
{
  "repository-policy": {
    "conflictScanDirs": ["src/content", "public/assets"],
    "allowTaggedActions": false
  }
}
```

(`allowTaggedActions` defaults to `true` — set it `false` to enforce full
commit-SHA action pins, the hardened house policy.)

Absent file or absent keys → defaults. This is the seam that lets one check run
unmodified across repos: the *rule* is central, the *parameters* are local.

## Adding a check

1. Write `checks/lib/<id>.mjs` exporting `{ id, name, effect, fix, gates, run(ctx) }`.
   `effect` is the check's blast radius on cordon's ladder — `read` for a pure
   inspection of the tree; add `network: true` / `interactive: true` if the check
   reaches off-box or needs a TTY. `run` returns `{ ok, detail }` or
   `{ skipped: true, detail }` — and never throws for a policy violation (throw
   only on a broken environment).
2. Register it in `registry.mjs`.

Graduate a check from a product repo only when it passes the boundary test
above: a general invariant, with at most a small declarative config seam. See
`lib/repository-policy.mjs` (graduated from `jseverino.com`) as the reference.
