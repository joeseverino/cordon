# The reusable gate

One workflow that tool, CLI, and MCP repos call for CI, so the CI logic lives in
one place. A repo never copies CI steps, tool setup, or pinned action SHAs.

## Adopt it

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  cordon:
    uses: joeseverino/cordon/.github/workflows/cordon-gate.yml@v2
```

The required status check is `cordon / gate` in every repo, so branch
protection is the same everywhere.

## What it does

[`cordon-gate.yml`](../.github/workflows/cordon-gate.yml):

1. checks out the calling repo without persisting credentials, and fetches
   cordon at `cordon-ref` outside the repo's tree;
2. sets up Node from the repo's `.nvmrc` (24 when there is none), installs the
   repo's npm or pnpm dependencies, and builds cordon's engine;
3. for a repo with a `pyproject.toml`, sets up uv and syncs its dependencies
   (with the `dev` extra when the repo declares one); for a repo with a
   `go.mod`, sets up Go at the version `go.mod` declares;
4. installs ShellCheck, ripgrep, and any `packages` the repo asks for;
5. runs the checks engine over the repo, folding the catalog checks detected
   from its stack (ruff and pytest for uv, gofmt, go vet and go test for Go, ShellCheck for shell, bats for a
   `tests/` suite, conformance for a cordon contract) with cordon's built-in
   invariants into one verdict, and writes the report to the run summary.

A setup step that fails, fails the gate.

## The only per-repo file: `cordon.checks.json`

Most repos need none: the catalog detects the stack. A repo adds the file to
turn a check off, tune one, or declare a command the catalog doesn't cover.

```json
{
  "$schema": "https://raw.githubusercontent.com/joeseverino/cordon/main/checks/config.schema.json",
  "commands": [
    { "id": "typecheck", "name": "TypeScript", "effect": "read", "requires": ["node"],
      "exec": { "cmd": "npm", "args": ["run", "typecheck"] } }
  ]
}
```

Each command is capability-gated (`requires`): it runs where its tool exists and
skips where it doesn't.

## Running it locally

The same engine runs on your machine from the published package, so a local
pass means a CI pass:

```sh
npx --yes --package cordon-spec@2 cordon-checks --root .
```

The fleet's `scripts/check.sh` is that one line.

## Inputs

| Input | Default | What |
| --- | --- | --- |
| `cordon-ref` | `v2` | The cordon tag, branch, or commit that provides the engine and schema |
| `runner` | `ubuntu-latest` | `macos-latest` for repos whose tools need macOS |
| `packages` | | Extra tools to install (apt names on Linux, brew formulae on macOS) |

## Versions

`@v2` follows the latest 2.x release: the release workflow moves the `v2` tag
to each new `v2.x.y`. The engine defaults to the same `v2`, so the workflow and
the checks it runs come from one release. To freeze both, pin the workflow to a
release tag and pass the same tag as `cordon-ref`:

```yaml
    uses: joeseverino/cordon/.github/workflows/cordon-gate.yml@v2.0.0
    with:
      cordon-ref: v2.0.0
```

## Changing things

- **CI for every repo:** edit `cordon-gate.yml` and release; repos on `@v2`
  pick it up.
- **One repo's checks:** edit that repo's `cordon.checks.json`.
- **Action pins:** live only in the gate; Dependabot keeps them current.
