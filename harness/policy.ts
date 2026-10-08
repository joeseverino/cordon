// Cordon harness — the runtime enforcement logic for the effect ladder.
//
// Cordon is the Policy Decision Point: it owns the ladder and the policy presets
// below. A consumer is a Policy Enforcement Point — a CLI wrapper, the MCP, or CI
// calls verdict() with a command's declared effect and acts on the decision. This
// module decides; it does not spawn the command (that is the enforcement point's
// job), which keeps it pure and testable. One decision logic, many enforcement
// points.

import fs from 'node:fs';
import { isRecord } from '../lib/guards.ts';
import { cordonAsset } from '../lib/root.ts';

// Source the ladder from the canonical schema so it can never drift from a
// hand-kept copy — the same one-source-of-truth rule the contract itself follows.
function effectLadder(schema: unknown): string[] {
  const defs = isRecord(schema) ? schema['$defs'] : undefined;
  const effect = isRecord(defs) ? defs['effect'] : undefined;
  const ladder = isRecord(effect) ? effect['enum'] : undefined;
  if (!Array.isArray(ladder) || !ladder.every((rung) => typeof rung === 'string')) {
    throw new Error('cordon: schema/cordon-v4.json has no $defs.effect.enum ladder');
  }
  return ladder;
}

export const EFFECTS = effectLadder(JSON.parse(fs.readFileSync(cordonAsset('schema', 'cordon-v4.json'), 'utf8')));

// What an enforcement point does with a declared effect.
export type Decision = 'allow' | 'confirm' | 'block';

export interface Preset {
  default: Decision;
  by_effect: Record<string, Decision>;
}

export interface Verdict {
  effect: string | null;
  declared: boolean;
  decision: Decision | undefined;
  reason: string;
}

// The slice of a `--describe` contract the gate reads.
export interface EffectContract {
  effect?: string;
  commands?: { name: string; effect?: string }[];
}

// Policy presets map each rung to a decision. `local` is the trusted
// single-operator posture (fail open on an unknown effect); `strict` is the
// multi-tenant / remote posture (fail closed). `default` applies when a command
// carries no declared effect — the runtime counterpart to the emitter's
// effect-honesty warning: local lets it run, strict refuses it.
export const PRESETS: { local: Preset; strict: Preset } = {
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
export function verdict(effect: string | null | undefined, preset: Preset = PRESETS.local): Verdict {
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
export function resolveEffect(contract: EffectContract, commandName?: string | null): string | undefined {
  if (!commandName) return contract.effect;
  const command = (contract.commands || []).find((c) => c.name === commandName);
  return command ? command.effect : undefined;
}
