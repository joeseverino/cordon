# Cordon harness — the reference enforcement point

The contract carries the `effect` signal; something has to act on it. The harness
is Cordon's runnable reference for that — the Policy Enforcement Point (PEP)
counterpart to the contract. **Opt-in and zero-dependency** (Node stdlib only).

Two pieces:

- **`policy.mjs` — the Policy Decision Point.** Pure decision logic:
  `verdict(effect, preset)` returns `allow` / `confirm` / `block` with a reason;
  `resolveEffect(contract, command)` picks the effect to gate on. The ladder is
  read from [`schema/cordon-v4.json`](../schema/cordon-v4.json), so it can't drift.
  Any consumer (a CLI wrapper, an MCP server, CI) imports this and enforces at its
  own surface. One decision logic, many enforcement points.
- **`gate.mjs` — a reference PEP for CLI tools.**
  `cordon-gate <tool> [command] [args...]` runs the tool's own `--describe`,
  resolves the command's effect, and allows / confirms / blocks before running it.

## Use

```sh
node harness/gate.mjs <tool> [command] [args...]
```

- `CORDON_POLICY=local` (default) — reads and writes run; `remote_write` /
  `deploy` confirm; a missing effect runs (fails open). The trusted
  single-operator posture.
- `CORDON_POLICY=strict` — `local_write` / `vault_write` confirm; `remote_write` /
  `deploy` block; a missing effect blocks (fails closed). The multi-tenant posture.
- At a TTY a `confirm` prompts `[y/N]`. Non-interactive, a `confirm` **fails
  closed** unless `CORDON_GATE_BYPASS=1` is set — an explicit, auditable escape. A
  `block` is never bypassable.

## What it does not do

- It is **not** wired into a shell or any tool. You invoke it explicitly; nothing
  is auto-gated, and a normal command path is unchanged.
- The wrapped tool needs **no** knowledge of cordon and gains **no** dependency on
  it. The harness reads the `--describe` output every emitter already produces, so
  a consumer repo stays standalone and cloneable.

## Verify

```sh
node harness/selftest.mjs   # verdict + effect-resolution invariants
```
