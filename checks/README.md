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
└── lib/<id>.mjs       one check each: { id, name, fix, gates, run(ctx) }
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
  "failed": ["repository-policy"],
  "report": ".cordon-checks-report.md",
  "checks": [
    { "id": "repository-policy", "name": "Repository Policy", "status": "fail",
      "durationMs": 25, "fix": "…", "rerun": "node checks/run.mjs --only repository-policy" }
  ]
}
```

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

1. Write `checks/lib/<id>.mjs` exporting `{ id, name, fix, gates, run(ctx) }`.
   `run` returns `{ ok, detail }` or `{ skipped: true, detail }` — and never
   throws for a policy violation (throw only on a broken environment).
2. Register it in `registry.mjs`.

Graduate a check from a product repo only when it passes the boundary test
above: a general invariant, with at most a small declarative config seam. See
`lib/repository-policy.mjs` (graduated from `jseverino.com`) as the reference.
