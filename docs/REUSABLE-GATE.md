# The reusable gate

One workflow, reused by every Severino repo, so CI logic lives in exactly one
place. A repo runs the full standard gate by *calling* it — it never copies CI
steps, tool setup, or pinned action SHAs.

## Adopt it (the whole CI file)

```yaml
# .github/workflows/cordon.yml
name: cordon
on: [push, pull_request]
jobs:
  cordon:
    uses: joeseverino/cordon/.github/workflows/cordon-gate.yml@main
```

That's the entire CI surface of a consuming repo. The required status check is
`cordon / gate` — the same across every repo, so branch protection is uniform
(`scripts/setup-governance.sh` defaults to it).

## What the gate does

[`cordon-gate.yml`](../.github/workflows/cordon-gate.yml), once:

1. checks out the calling repo, and cordon alongside it (engine + schema,
   referenced never vendored);
2. sets up Node (the engine), and — only when the repo has a `pyproject.toml` —
   uv plus a dependency sync;
3. installs shellcheck + ripgrep for the checks that need them;
4. runs the checks engine over the repo's **own `cordon.checks.json`**, folding
   its commands with cordon's built-in repo invariants into one verdict, and
   surfaces the report.

## The only per-repo file: `cordon.checks.json`

Logic is central; parameters are local. A repo declares *its* commands as data —
nothing else. Example (a Python repo):

```json
{
  "$schema": "https://raw.githubusercontent.com/joeseverino/cordon/main/checks/config.schema.json",
  "commands": [
    { "id": "ruff",   "name": "Ruff lint", "effect": "read", "requires": ["uv"],
      "exec": { "cmd": "uv", "args": ["run", "ruff", "check", "."] } },
    { "id": "pytest", "name": "Pytest",    "effect": "read", "requires": ["uv"],
      "exec": { "cmd": "uv", "args": ["run", "pytest", "-q"] } }
  ]
}
```

Each command is capability-gated (`requires`), so it runs where its tool exists
and skips fail-soft where it doesn't — the same file is portable across repos.

## Runner + tooling are data too (`runner`, `packages`)

A repo that needs macOS or extra tools never edits its workflow — it sets two
keys in `cordon.checks.json`, and the gate's `detect` job reads them:

```json
{
  "runner": "macos-latest",
  "packages": "bash zsh bats-core age jq"
}
```

`runner` defaults to `ubuntu-latest`; `packages` are installed beyond the gate's
`shellcheck` + `ripgrep` base (brew formulae on macOS, apt names on Linux). So
**every repo's `ci.yml` stays the identical bare gate call** — the per-repo runner
lives in data, not the workflow. (This adds a uniform `cordon / detect` check
beside `cordon / gate`, since a job's runner can't be read from a file mid-job.)

## Changing things

- **CI behavior for every repo** → edit `cordon-gate.yml` here. One change, all repos.
- **A repo's own commands** → edit that repo's `cordon.checks.json`.
- **Pinned action SHAs** → live only in the gate; Dependabot (github-actions
  ecosystem) keeps them current. No repo pins actions itself.

## Pinning the gate

`@main` tracks the latest gate. Pin `@<tag>` (or a SHA) for reproducibility;
Dependabot can bump that reference too.
