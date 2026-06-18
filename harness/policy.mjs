// Cordon harness — the runtime enforcement logic for the effect ladder.
//
// Cordon is the Policy Decision Point: it owns the ladder and the policy presets
// below. A consumer is a Policy Enforcement Point — a CLI wrapper, the MCP, or CI
// calls verdict() with a command's declared effect and acts on the decision. This
// module decides; it does not spawn the command (that is the enforcement point's
// job), which keeps it pure and testable. One decision logic, many enforcement
// points.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Source the ladder from the canonical schema so it can never drift from a
// hand-kept copy — the same one-source-of-truth rule the contract itself follows.
const schema = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'schema', 'cordon-v4.json'), 'utf8'),
);
export const EFFECTS = schema.$defs.effect.enum;

// What an enforcement point does with a declared effect.
export const DECISIONS = ['allow', 'confirm', 'block'];

// Policy presets map each rung to a decision. `local` is the trusted
// single-operator posture (fail open on an unknown effect); `strict` is the
// multi-tenant / remote posture (fail closed). `default` applies when a command
// carries no declared effect — the runtime counterpart to the emitter's
// effect-honesty warning: local lets it run, strict refuses it.
export const PRESETS = {
  local: {
    default: 'allow',
    by_effect: {
      read: 'allow',
      local_write: 'allow',
      vault_write: 'allow',
      remote_write: 'confirm',
      deploy: 'confirm',
    },
  },
  strict: {
    default: 'block',
    by_effect: {
      read: 'allow',
      local_write: 'confirm',
      vault_write: 'confirm',
      remote_write: 'block',
      deploy: 'block',
    },
  },
};

// Decide what to do with a declared effect under a preset. `effect` null/undefined
// means the command declared none, which routes to the preset default. An effect
// off the ladder is a programming error (a typo must not silently weaken a gate).
export function verdict(effect, preset = PRESETS.local) {
  if (effect != null && !EFFECTS.includes(effect)) {
    throw new Error(`effect ${JSON.stringify(effect)} not on the ladder ${EFFECTS.join(' → ')}`);
  }
  const declared = effect != null;
  const decision = declared ? preset.by_effect[effect] : preset.default;
  const reason = declared
    ? `declared effect '${effect}' → ${decision}`
    : `no declared effect → ${decision} (preset default)`;
  return { effect: effect ?? null, declared, decision, reason };
}

// Resolve the effect a verdict should gate on: a named command's effect, or the
// tool-level effect when no command is named. Returns undefined when the command
// isn't in the contract, so verdict() routes it through the preset default.
export function resolveEffect(contract, commandName) {
  if (!commandName) return contract.effect;
  const command = (contract.commands || []).find((c) => c.name === commandName);
  return command ? command.effect : undefined;
}
