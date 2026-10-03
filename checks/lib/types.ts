// Shared shapes for cordon's checks — the one definition of the invariant
// contract registry.ts documents ({ id, name, effect, gates, fix, run(ctx) }
// plus optional { configSchema, requires, phase, repair(ctx) }), and the
// loose JSON shapes the catalog and config composer share.

// cordon's blast-radius ladder (config-schema's EFFECT_LADDER).
export type Effect = 'read' | 'local_write' | 'vault_write' | 'remote_write' | 'deploy';
export type Phase = 'pre-build' | 'build' | 'post-build';

// An arbitrary JSON Schema fragment, as composed into config.schema.json.
export type JsonSchema = Record<string, unknown>;
// A check's (user-supplied) slice of cordon.checks.json, before narrowing.
export type CheckConfig = Record<string, unknown>;

// A JSON Schema fragment for a check's slice of cordon.checks.json. Only the
// parts defaultsOf reads are typed; the rest passes through to the composer.
export interface ConfigSchema {
  type?: string | string[];
  description?: string;
  additionalProperties?: boolean;
  properties?: Record<string, { default?: unknown; [key: string]: unknown }>;
  [key: string]: unknown;
}

// ctx = { root, config }. `config` is this check's (user-supplied) slice,
// merged over the check's defaults.
export interface CheckContext<C extends object = CheckConfig> {
  root: string;
  config?: Partial<C>;
}

export interface SkipResult { skipped: true; ok?: never; detail: string }
export interface VerdictResult { ok: boolean; skipped?: never; detail: string }
// run -> { ok, detail } | { skipped: true, detail }
export type CheckResult = VerdictResult | SkipResult;
// repair -> { ok, detail } ({ ok: false } marks the repair itself as failed).
export interface RepairResult { ok?: boolean; detail?: string }

export interface Check<C extends object = CheckConfig> {
  id: string;
  name: string;
  effect: Effect;
  gates: string[];
  fix: string;
  requires?: string[];
  phase?: Phase;
  configSchema?: ConfigSchema;
  run(ctx: CheckContext<C>): CheckResult;
  repair?(ctx: CheckContext<C>): RepairResult | undefined;
}
