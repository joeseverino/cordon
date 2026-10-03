# Cordon checks

A portable **gate engine** — the repo-level sibling of `conformance/`. Where
conformance answers *"does this command surface match the contract?"*, checks
answer *"is this repository shippable, and what fixes each failure?"* Both are the
same idea cordon exists for: **a guarantee declared once, centrally, that a repo
*references* instead of reimplementing** — so it can't drift, and an agent reads
the verdict before it acts.

![cordon's checks engine in one line: invariants plus your command specs flow into one engine that emits one verdict — pass, fail, or skip.](../docs/diagrams/checks-engine-mini.png)

The engine runs every applicable check over a repo, in phase order, skipping
fail-soft what the environment can't satisfy, and emits one machine-readable
verdict ([`schema/cordon-checks-v2.json`](../schema/cordon-checks-v2.json)).
[See a real run report →](example-report.md) · [the full flow ↓](#the-full-flow).

```
checks/
├── run.ts               the engine — merge, capability-gate, phase, verdict, report
├── registry.ts          the inventory of built-in invariants (data + module refs)
├── catalog.ts           the inventory of built-in commands (per-stack, auto-detected)
├── config-schema.ts     derives the cordon.checks.json schema from each check
├── selftest.ts          hermetic engine self-test (npm test runs it)
└── lib/
    ├── <id>.ts             one invariant each: { id, name, effect, fix, gates, run(ctx) }
    ├── types.ts            the Check / CheckContext / CheckResult contract, stated once
    ├── capabilities.ts     detect git/macos/ci/file:/glob:/<binary> — "respect what's available"
    ├── discover-scripts.ts synthesize read checks from a repo's package.json check:* scripts
    ├── shellcheck-repo.sh  shell-file discovery for the catalog's shellcheck (ext + shebang)
    ├── run-process.ts      the spawn harness for command entries (timeout, capture)
    └── config.ts           defaultsOf(configSchema) — runtime defaults from the one declaration
```

## Two kinds of check — invariants and commands

| | **invariant** | **command** |
|---|---|---|
| what | an in-process portable rule | a spawned spec (a binary/script) |
| examples | `repository-policy`, `bats-assertions` | `ruff`, `pytest`, `shellcheck`, a bespoke audit |
| lives in | cordon (`registry.ts`) | cordon's catalog (`catalog.ts`) **or** the repo (`cordon.checks.json`) |
| why there | a *general* rule, so it's referenced not reimplemented | per-stack ones graduate to the catalog; repo-specific ones stay home |

The engine merges both at run time and runs them through one loop, so a verdict
row looks the same whichever kind produced it. This is the boundary doctrine made
mechanical: **invariant *definitions* graduate up here; command *definitions* stay
home** — but the *engine* is central, so neither repo reimplements the runner, the
verdict, the phases, or the capability gating.

### Where commands come from — auto-detect first, declare only what's bespoke

A command can reach the engine three ways, and the **common case is none of your
doing**:

1. **cordon's catalog** (`catalog.ts`) — per-stack checks (`ruff`/`pytest` for a
   uv repo, `gofmt`/`go-vet`/`go-test` for a Go module, `conformance`/`drift`
   for a cordon-tool repo, `shellcheck`/`bats`
   for a shell toolchain). Each is gated by a stack marker
   (`file:pyproject.toml`, `file:contract`, `glob:**/*.sh`…), so it lights up
   **only** where its stack is present. A repo gets them with no config. `pytest`
   additionally runs **once per Python version** the package declares in
   `[project].classifiers` (`uv run --python <v> pytest`) — multi-version coverage
   as one check, no CI matrix, and it runs locally too. Override with
   `{ "pytest": { "pythonVersions": [...] } }`, or `[]` for a single run. A uv
   package also gets `package-smoke` — it builds the wheel and imports it from an
   isolated env, catching "imports from source, broken once installed" packaging
   bugs the source-tree pytest can't see (no-ops where there's no build backend,
   so it only fails on a real packaging error).
2. **Discovery** (`discover-scripts.ts`) — your `package.json` `check:*` scripts
   are read in as `read` checks. Declare a bespoke audit once, where you already
   keep tasks; cordon picks it up. No re-listing.
3. **Your `commands[]`** — the escape hatch for a spawned spec the catalog
   doesn't cover, with its blast-radius `effect` declared. An id here overrides a
   catalog check of the same id (repo wins).

So **most repos carry no `cordon.checks.json` at all** — the engine detects the
stack and runs the right checks. You write a file only to *deviate*: flip a check
on/off by name with `enable`/`disable`, tune a built-in's options, or add a truly
bespoke `commands[]` entry. Run `--list` to see exactly what a repo resolves to,
each row marked `run`/`skip` with its source and reason.

### checks vs tests — the boundary

> A **check** asserts a *general invariant about an artifact* (the repo, its
> sources, its config). The rule is universal → it graduates here as an
> invariant and every repo references it.
>
> A **test** exercises the *behavior of code a specific repo wrote* (a parser, an
> API handler, a rendered page). It's coupled to its subject → it stays in that
> repo's `tests/`, and the repo runs it through the engine as a **command** entry.

If a check needs to know what *your* code does, it's a command (home), not an
invariant (graduated). Don't push it up to cordon.

## Gates and phases

Each check declares the `gates` it belongs to, and a gate is just
`checksFor(name)` over the registry — **completeness is structural**: register a
check and every gate that claims it runs it, no second edit. cordon ships one
gate, `check`; a consumer adds its commands to its `cordon.checks.json` and they
join the run.

**Phases** order the run around a repo's own build step: `pre-build` → `build`
→ `post-build`. A command declares its `phase` (default `pre-build`; every
built-in check is pre-build) and the engine runs phases in order, so a repo's
`post-build` command (a smoke test of what its build emitted) runs after its
`phase: 'build'` command. The build itself is just a `command`, so a consumer
needs no orchestrator. `--phase <p>` runs one phase (a fast inner loop).

## Capabilities — respect what's available, default lean

A check declares the capabilities it `requires`; the engine detects what's
present and **skips fail-soft** what isn't, naming the unmet ones in the verdict.
So a repo lights up only what it opts into — shellcheck runs only where shellcheck
is installed, a `macos`-only suite never fails a Linux runner. This is also the
**stack auto-detection**: a catalog check `requires` a marker (`file:uv.lock`,
`file:contract`), so it runs only in that stack and skips everywhere else. The
engine's built-in checks are scoped to tool/CLI/MCP repos, not websites or web
apps.

| capability | true when |
|---|---|
| `git` | the root is a git work tree |
| `macos` | running on Darwin |
| `ci` | `process.env.CI` is set |
| `file:<path>` | a file or dir exists at `<root>/<path>` — the stack marker (e.g. `file:pyproject.toml`) |
| `glob:<pattern>` | at least one path matches, ignoring `node_modules/` and `.git/` (e.g. `glob:**/*.sh`) |
| `<binary>` | any other token resolves on PATH or in `node_modules/.bin` (e.g. `shellcheck`) |

A leading `!` negates — `requires: ["!ci"]` means *only when not in CI* (the
portable form of an authoring-machine-only check). The vocabulary is
[`lib/capabilities.ts`](lib/capabilities.ts).

## The full flow

<img src="../docs/diagrams/checks-engine.png" alt="Two kinds of check — cordon's portable invariants and a repo's own command specs — merge into one checks engine. Each is capability-gated: if the repo has what the check requires (git, macos, a binary) it runs in phase order pre-build → build → post-build to PASS or FAIL (carrying fix + rerun); if not, it SKIPs fail-soft, naming the unmet capability. All three outcomes collect into one cordon-checks-v2 verdict — human output plus --json — that users read and agents risk-gate on before they act." width="540">

<sup>Diagram source: [`docs/diagrams/checks-engine.mmd`](../docs/diagrams/checks-engine.mmd),
pre-rendered with [`diagram`](https://github.com/joeseverino/tools/blob/main/bin/diagram).</sup>

## Run it

```sh
node checks/run.ts                 # all applicable checks over the cwd (human)
node checks/run.ts --root <dir>    # over another repo
node checks/run.ts --phase <p>     # only pre-build | build | post-build
node checks/run.ts --only <id>     # one check (this is the printed rerun line)
node checks/run.ts --json          # the agent/CI contract (sole stdout)
node checks/run.ts --fix           # run declared repairs on failures, re-run to prove them
node checks/run.ts --list          # the checks that apply to this repo
node checks/run.ts --schema        # the cordon.checks.json JSON Schema
```

A consuming repo runs the same engine from the published package, never a copy:

```sh
npx --yes --package cordon-spec@2 cordon-checks --root .
```

### Autofix — `--fix`

The gate stops at *reporting* by default; `--fix` lets a check that declared a
mechanical repair also *apply* it. Three seams declare one, all optional:

- an **invariant** exports `repair(ctx)` alongside `run(ctx)` (registry.ts
  documents the contract);
- a **catalog or repo command** declares `fixExec` — the repair process to spawn
  (the catalog's `ruff` ships `uv run ruff check --fix`);
- a **discovered `check:<name>` script** pairs automatically with a
  `fix:<name>` script in the same package.json — declare the pair once, where
  you already keep tasks.

The loop is repair → **re-run the same check** → only a green re-run reports
`fixed` (a repair is proven by its verifier, never trusted). A repair that
errors or doesn't heal leaves the original failure, annotated. Checks without a
repair fail exactly as before, and a plain run never mutates — repairs run only
under the explicit `--fix`. Fixed rows carry their `repair` audit trail in the
verdict (`fixed[]` + status `fixed`, `schema_version 3`); the worktree changed,
so review and commit what the repair wrote. CI runs the plain gate — `--fix` is
the human/agent inner loop, not a CI mode.

## The `--json` contract

The repo-level analog of `--describe`: a machine-readable verdict an agent or CI
acts on without parsing prose. `ok` is the gate; each failed check carries its own
`fix` and the exact `rerun` command.

```json
{
  "ok": false,
  "schema_version": 2,
  "failed": ["dispatch-dups"],
  "report": ".cordon-checks-report.md",
  "checks": [
    { "id": "repository-policy", "name": "Repository Policy", "status": "pass",
      "durationMs": 22, "effect": "read", "phase": "pre-build" },
    { "id": "dispatch-dups", "name": "CLI Dispatch Duplicates", "status": "fail",
      "durationMs": 11, "effect": "read", "phase": "pre-build",
      "fix": "…", "rerun": "node checks/run.ts --only dispatch-dups" },
    { "id": "smoke-dist", "name": "Smoke-test the build", "status": "skip",
      "durationMs": 0, "effect": "local_write", "phase": "post-build",
      "unmet": ["hyperfine", "macos"] }
  ]
}
```

This verdict is a **versioned contract** — [`schema/cordon-checks-v2.json`](../schema/cordon-checks-v2.json),
the repo-level sibling of the command-surface schema — and `checks/run.ts --json`
is its reference emitter, validated by [`conformance/validate.ts`](../conformance/validate.ts)
(the harness picks the contract by shape, then the version by `schema_version`,
so v1 verdicts stay valid). The schema enforces the signals an agent needs: a
`fail` check **must** carry `fix` + `rerun`, every check carries its own `effect`,
and `unmet` may ride only a `skip`.

The signals the engine adds over v1:

- **`phase`** — where the check ran around the build. Emitted on every row when
  the run spans more than one phase; omitted when it's a single (pre-build) pass,
  so the common case stays minimal.
- **`unmet`** — the capabilities a skipped check needed but the environment
  lacked. This is what makes a skip *legible*: an agent reads *why* a check
  skipped (not installed vs wrong platform), not just that it did.
- **`detail`** — on a failed row, the failure's specifics (which link/line/path,
  or the captured command output) — the same text the human report folds in. So
  an agent acts on the `--json` verdict directly, without parsing the markdown
  report.

`effect` is cordon's blast-radius ladder applied to the check itself — the cost of
*producing* the row, in the same vocabulary a command's `--describe` uses. A
`read` invariant is safe to run anywhere; a check that reaches off-box rides
`network: true` (and `interactive: true` if it blocks on a TTY), emitted only when
true. A **command** entry carries the `effect` its registry declares — so an
unclassified spec can never run as if it were a safe read (the engine fails closed
on a command with no `effect`).

`status` is `pass | fail | skip`. A check skips when a capability is unmet
(`unmet` names it) or when the artifact it inspects is simply absent (no `.nvmrc`,
not a git repo) — **fail-soft** either way. Zero config still runs every universal
invariant.

## The report (`.cordon-checks-report.md`)

The human render of the same `results` the `--json` verdict derives from — a
whole-picture **status table** (every check, not just failures, so a *skip* is
never mistaken for a *pass*), then each failure's `fix` + `rerun` + the captured
output folded in a `<details>`, then a provenance footer. Markdown, and in CI the
engine writes it straight to `$GITHUB_STEP_SUMMARY`, so it renders inline in the
run summary on a green or red gate — no cat-after-the-fact a failing exit could skip.

It is written **on failure** by default, so a green local run leaves no file
behind. `--report` writes it even when green (the always-there record), and a CI
run (the `CI` env) turns that on automatically — so the summary is always there in
CI but never clutters a local green run. It is **gitignored, never committed**.
(The `--json` `report` field stays the *failure* pointer: the path on failure,
`null` on a green run.)

See [**`example-report.md`**](example-report.md) for a real one — a failing CI run
and a green run, side by side.

## Per-repo configuration

**The file is optional, and usually absent** — the catalog auto-detects the stack
and discovery picks up your `check:*` scripts, so most repos run the right checks
with no `cordon.checks.json` at all. You add one only to *deviate*. When you do,
the bare-minimum knobs are names only:

- **`disable: ["<id>"]`** — turn an auto-detected check off. Just its name; no
  effect, command, or fix to restate.
- **`enable: ["<id>"]`** — turn an opt-in (`default: 'off'`) check on.

Beyond that, a check-id key tunes a built-in's options (handed to it as
`ctx.config`, merged over its defaults); `commands` adds the repo's own spawned
specs. Point its `$schema` at the published schema and your editor autocompletes
every key, documents it on hover, and flags typos as you type:

```json
{
  "$schema": "https://jseverino.com/schemas/cordon-checks-config-v2.json",
  "disable": ["bats-assertions"],
  "repository-policy": { "allowTaggedActions": false },
  "pytest": { "pythonVersions": ["3.12", "3.13"] },
  "commands": [
    { "id": "types", "name": "Type check", "effect": "read",
      "requires": ["tsc"], "exec": { "cmd": "npx", "args": ["tsc", "--noEmit"] } }
  ]
}
```

Absent file or absent keys → auto-detected defaults. This is the seam that lets
one engine run unmodified across repos: the *rules, runner, and per-stack checks*
are central, only the *deviations* are local.

### The config schema is derived, never hand-written

An invariant declares its config seam **once**, as a `configSchema` JSON Schema
fragment on its default export — and that single declaration is the source for
both the check's runtime defaults (`defaultsOf` in [`lib/config.ts`](lib/config.ts))
and its slice of the published file schema. [`config-schema.ts`](config-schema.ts)
composes those fragments over the registry — plus the engine's own `enable`/`disable`
and `commands[]` shape — into one document, emitted by `run.ts --schema`. So adding a
knob is one edit in one file, and a field's type, docs, and default can't drift.

The composed document is committed at [`config.schema.json`](config.schema.json)
— the artifact the `$schema` URL serves — and cordon keeps it fresh by
**dogfooding its own `idempotence` check**: cordon's [`cordon.checks.json`](../cordon.checks.json)
runs the regen command, so `npm run checks` fails if the committed schema ever
lags the source. Editor experience and drift safety from the same one feature.

## Adding a check

**An invariant** (portable — graduate it here):

1. Write `checks/lib/<id>.ts` exporting `{ id, name, effect, gates, fix, run(ctx) }`,
   plus optional `{ configSchema, requires, phase }`. `effect` is its blast radius
   (`read` for a pure inspection; add `network`/`interactive` if it reaches off-box
   or needs a TTY). `requires` are the capabilities it needs (e.g. `['git']`).
   `run({ root, config })` returns `{ ok, detail }` or `{ skipped, detail }` — and
   never throws for a violation (throw only on a broken environment).
2. If it takes config, add a `configSchema` and derive defaults with
   `defaultsOf(configSchema)` — one declaration feeds runtime *and* the file schema.
3. Register it in `registry.ts`.

The new check's knobs then light up in `--schema`, every editor pointed at the
published file, and `--list`/`--json` with no second edit. Graduate a check from a
product repo only when it passes the boundary test: a general invariant with at
most a small declarative config seam. See `lib/repository-policy.ts` (graduated
from `jseverino.com`) and `lib/dispatch-dups.ts` as references.

**A catalog command** (a per-stack check every repo of that stack should get): add
an entry to `CATALOG` in [`catalog.ts`](catalog.ts) — `{ id, name, effect, exec,
fix }` plus a `requires` of stack markers (`file:…`/`glob:…`/`<binary>`) that gate
it to its stack, and `default: 'off'` if it should be opt-in. It then
auto-detects in every matching repo with no per-repo config. This is a command's
equivalent of graduating an invariant: a check that's the same in every uv (or
cordon-tool, or shell) repo belongs here, not copy-pasted into each `cordon.checks.json`.

**A repo command** (a spec unique to one repo — keep it home): add an entry to
`commands[]` in your `cordon.checks.json` (the editor autocompletes the shape), or
— if it's a Node audit — just name it `check:<thing>` in `package.json` and
discovery folds it in. No code in cordon; the engine spawns it, gates it on its
`requires`, and folds it into the same verdict.
