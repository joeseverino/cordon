// Cordon reference emitter for Node — declare a small typed spec.
//
// The Node sibling of the bash toolchain's `lib/describe.sh` (declare a surface
// in a DSL) and the Python `cordon_emit` (introspect an argparse parser). The
// Node/TS world has no single introspectable parser — an Astro site, a Wrangler
// config, an npm-script wrapper — so here you *declare* the surface as one small
// typed object and this projects it to the one Cordon v4 contract. Same schema,
// same byte-deterministic output, so a Node emitter converges with the bash and
// Python ones instead of drifting.
//
// Pure and dependency-free: `renderSurface(spec)` takes a typed spec and returns
// a JSON-serializable object that validates against schema/cordon-v4.json.
// `emitMain(spec, { url })` is the one-line drop-in for an emitter script:
// `--describe` prints the contract, `--write` (re)writes the committed golden,
// `--check` fails on drift — the same `bin/<tool> --describe` convention cordon's
// gate already drives, so conformance + drift cover a Node emitter unchanged.
//
// Depend on it, don't copy it, so the emitter tracks the schema. A copy drifts.
//
//   import { emitMain } from 'cordon-spec/emit';
//   emitMain(spec, { url: import.meta.url });   // handles --describe/--write/--check

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Contract revision this emitter targets. Bump only in lockstep with a new
// schema/cordon-vN.json — adding a field to v4 is itself a wire-format change.
export const SCHEMA_VERSION = 4;

// The escalating blast-radius ladder. The emitter does not police which effect a
// command declares (that is the author's honesty), but it rejects a value off
// the ladder so a typo can't silently weaken a gate.
export type Effect = 'read' | 'local_write' | 'vault_write' | 'remote_write' | 'deploy';
export const EFFECTS: Effect[] = ['read', 'local_write', 'vault_write', 'remote_write', 'deploy'];
const LADDER: readonly unknown[] = EFFECTS;

// ---- the declaration DSL: what an emitter script hands renderSurface -------

export interface PositionalSpec {
  name: string;
  help: string;
  optional?: boolean;
  variadic?: boolean;
  repeatable?: boolean;
  choices?: readonly string[];
}

export interface OptionSpec {
  flags: readonly string[];
  help: string;
  /** Defaults to the first long (--) flag, else the first flag. */
  name?: string;
  takesValue?: boolean;
  metavar?: string;
  repeatable?: boolean;
  choices?: readonly string[];
}

/** `[command, comment?]` or `{ command, comment? }`. */
export type ExampleSpec = [command: string, comment?: string] | { command: string; comment?: string };

export interface ArgScopeSpec {
  positionals?: readonly PositionalSpec[];
  options?: readonly OptionSpec[];
}

export interface CommandSpec extends ArgScopeSpec {
  name: string;
  summary?: string;
  /** Defaults to 'read' — reported by undeclaredEffects as a silent fail-open. */
  effect?: Effect;
  network?: boolean;
  interactive?: boolean;
  paras?: readonly string[];
  examples?: readonly ExampleSpec[];
  delegates?: string;
}

/** A surface's `options` and `positionals` project to `global_options` and `positionals`. */
export interface SurfaceSpec extends ArgScopeSpec {
  name: string;
  group: string;
  order: number;
  description?: string;
  effect?: Effect;
  network?: boolean;
  interactive?: boolean;
  paras?: readonly string[];
  examples?: readonly ExampleSpec[];
  commands?: readonly CommandSpec[];
}

// ---- the emitted document: schema/cordon-v4.json ---------------------------

export interface ContractPositional {
  name: string;
  positional: true;
  required: boolean;
  help: string;
  variadic?: true;
  repeatable?: true;
  choices?: string[];
}

export interface ContractOption {
  name: string;
  positional: false;
  required: false;
  help: string;
  flags: string[];
  takes_value: boolean;
  metavar?: string;
  repeatable?: true;
  choices?: string[];
}

export type ContractArgument = ContractOption | ContractPositional;

export interface ContractExample {
  command: string;
  comment: string;
}

export interface ContractCommand {
  name: string;
  summary: string;
  args: ContractArgument[];
  effect: Effect;
  network?: true;
  interactive?: true;
  paras: string[];
  examples: ContractExample[];
  delegates?: string;
}

export interface CordonContract {
  ok: true;
  schema_version: typeof SCHEMA_VERSION;
  name: string;
  description: string;
  group: string;
  order: number;
  effect: Effect;
  network?: true;
  interactive?: true;
  global_options: ContractOption[];
  positionals: ContractPositional[];
  paras: string[];
  examples: ContractExample[];
  commands: ContractCommand[];
}

function assertEffect(effect: unknown, where: string): asserts effect is Effect {
  if (!LADDER.includes(effect)) {
    throw new Error(`cordon: effect ${JSON.stringify(effect)} at ${where} is not on the ladder [${EFFECTS.join(' < ')}]`);
  }
}

// ---- projection: typed spec -> canonical cordon-v4 -------------------------
// Keys are emitted in schema order and optional keys only when set, so the JSON
// is byte-deterministic — a guard diffs it, and two emitters converge on it.

function renderPositional(p: PositionalSpec): ContractPositional {
  if (!p || typeof p.name !== 'string' || typeof p.help !== 'string') {
    throw new Error('cordon: a positional needs string `name` and `help`');
  }
  const out: ContractPositional = { name: p.name, positional: true, required: !p.optional, help: p.help };
  if (p.variadic) out.variadic = true;
  if (p.repeatable) out.repeatable = true;
  if (p.choices) out.choices = [...p.choices];
  return out;
}

function renderOption(o: OptionSpec): ContractOption {
  if (!o || !Array.isArray(o.flags) || o.flags.length === 0 || typeof o.help !== 'string') {
    throw new Error('cordon: an option needs a non-empty `flags` array and string `help`');
  }
  // Name an option by its first long (--) flag, matching the bash and Python
  // emitters so a federated document is homogeneous; fall back to the first flag.
  const name = o.name ?? o.flags.find((f) => f.startsWith('--')) ?? o.flags[0] ?? '';
  const out: ContractOption = {
    name,
    positional: false,
    required: false,
    help: o.help,
    flags: [...o.flags],
    takes_value: Boolean(o.takesValue),
  };
  if (out.takes_value && o.metavar) out.metavar = o.metavar;
  if (o.repeatable) out.repeatable = true;
  if (o.choices) out.choices = [...o.choices];
  return out;
}

function renderArgs(scope: ArgScopeSpec): ContractArgument[] {
  return [
    ...(scope.positionals ?? []).map(renderPositional),
    ...(scope.options ?? []).map(renderOption),
  ];
}

function renderExample(ex: ExampleSpec): ContractExample {
  const [command, comment] = Array.isArray(ex) ? ex : [ex.command, ex.comment];
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('cordon: an example needs a non-empty `command`');
  }
  return { command, comment: comment ?? '' };
}

function renderCommand(c: CommandSpec): ContractCommand {
  if (!c || typeof c.name !== 'string' || c.name.length === 0) {
    throw new Error('cordon: a command needs a non-empty `name`');
  }
  const effect = c.effect ?? 'read';
  assertEffect(effect, `command ${JSON.stringify(c.name)}`);
  // Conditional spreads keep the schema key order the mutation form had.
  return {
    name: c.name,
    summary: c.summary ?? '',
    args: renderArgs(c),
    effect,
    ...(c.network ? { network: true } : {}),
    ...(c.interactive ? { interactive: true } : {}),
    paras: [...(c.paras ?? [])],
    examples: (c.examples ?? []).map(renderExample),
    ...(c.delegates ? { delegates: c.delegates } : {}),
  };
}

/** Project a typed spec into the canonical Cordon v4 document. Pure. */
export function renderSurface(spec: SurfaceSpec): CordonContract {
  if (!spec || typeof spec.name !== 'string' || spec.name.length === 0) {
    throw new Error('cordon: a surface spec needs a non-empty `name`');
  }
  if (typeof spec.group !== 'string' || spec.group.length === 0) {
    throw new Error(`cordon: surface ${JSON.stringify(spec.name)} needs a non-empty inventory \`group\``);
  }
  if (!Number.isInteger(spec.order) || spec.order < 1) {
    throw new Error(`cordon: surface ${JSON.stringify(spec.name)} needs an integer \`order\` >= 1`);
  }
  const effect = spec.effect ?? 'read';
  assertEffect(effect, `surface ${JSON.stringify(spec.name)}`);

  const names = (spec.commands ?? []).map((c) => c.name);
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) throw new Error(`cordon: duplicate command name ${JSON.stringify(dupe)}`);

  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    name: spec.name,
    description: spec.description ?? '',
    group: spec.group,
    order: spec.order,
    effect,
    ...(spec.network ? { network: true } : {}),
    ...(spec.interactive ? { interactive: true } : {}),
    global_options: (spec.options ?? []).map(renderOption),
    positionals: (spec.positionals ?? []).map(renderPositional),
    paras: [...(spec.paras ?? [])],
    examples: (spec.examples ?? []).map(renderExample),
    commands: (spec.commands ?? []).map(renderCommand),
  };
}

/** Commands that relied on the `read` default instead of declaring an effect —
 *  the silent fail-open the contract exists to surface. Empty = every blast
 *  radius was an explicit choice. */
export function undeclaredEffects(spec: SurfaceSpec): string[] {
  return (spec.commands ?? []).filter((c) => c.effect === undefined).map((c) => c.name);
}

// ---- introspect: derive a surface from package.json `scripts` --------------
// The emit-once path for an npm repo. A repo's command surface is `npm run <x>`,
// and those live in exactly one place — package.json `scripts`. So derive the
// commands from there (names, and the literal command each delegates to) instead
// of re-declaring them. The one fact `scripts` can't carry is each command's
// blast radius — the human supplies it once via `effects`, which doubles as the
// allowlist of which scripts are part of the public surface (emitter plumbing
// like `describe`/`build:*` stays out unless it's named). Change a script and
// the contract re-derives; add one to `effects` and a command appears.

export interface PackageJson {
  name: string;
  description?: string;
  scripts: Record<string, string>;
}

export interface ScriptsOptions {
  effects: Readonly<Record<string, string | undefined>>;
  group: string;
  order: number;
  name?: string | undefined;
  description?: string;
  paras?: readonly string[];
  summaries?: Readonly<Record<string, string>>;
  network?: Readonly<Record<string, boolean>>;
  interactive?: Readonly<Record<string, boolean>>;
}

/**
 * Project an npm repo's `package.json` scripts into a typed surface spec.
 * @param {object} pkg  the parsed package.json
 * @param {{ effects: Record<string,string>, group: string, order: number,
 *           name?: string, description?: string, paras?: string[],
 *           summaries?: Record<string,string>, network?: Record<string,boolean>,
 *           interactive?: Record<string,boolean> }} opts
 *   `effects` maps each EXPOSED script name to its blast radius (and is the
 *   inclusion list). `summaries`, `network`, and `interactive` optionally tag a script.
 * @returns a spec for renderSurface / emitMain.
 */
export function describeScripts(pkg: PackageJson, opts: ScriptsOptions = { effects: {}, group: '', order: 0 }): SurfaceSpec {
  const { effects, group, order, summaries = {}, network = {}, interactive = {} } = opts;
  if (!pkg || typeof pkg !== 'object' || typeof pkg.scripts !== 'object') {
    throw new Error('cordon: describeScripts needs a package.json with a `scripts` object');
  }
  if (!effects || typeof effects !== 'object' || Object.keys(effects).length === 0) {
    throw new Error('cordon: describeScripts needs a non-empty `effects` map — each exposed script\'s blast radius (the one fact scripts can\'t carry)');
  }
  const commands = Object.keys(effects).map((script) => {
    const run = pkg.scripts[script];
    if (run === undefined) {
      throw new Error(`cordon: \`effects\` names script ${JSON.stringify(script)}, but package.json has no such script`);
    }
    const effect = effects[script];
    assertEffect(effect, `script ${JSON.stringify(script)}`);
    const command: CommandSpec = {
      name: script,
      summary: summaries[script] ?? '',
      effect,
      // DERIVED, not declared: the literal command the script runs is who owns
      // the real surface (flags/args). Re-derives when the script changes.
      delegates: run,
    };
    if (network[script]) command.network = true;
    if (interactive[script]) command.interactive = true;
    return command;
  });
  return {
    name: opts.name ?? pkg.name,
    description: opts.description ?? pkg.description ?? '',
    group,
    order,
    effect: 'read',
    paras: opts.paras ?? [],
    commands,
  };
}

/** Serialize a contract: pretty 2-space + trailing newline — reviewable in a
 *  diff and stable for the drift check. Pass `{ compact: true }` for the
 *  byte-minimal form a guard compares. */
export function serialize(doc: unknown, { compact = false }: { compact?: boolean } = {}): string {
  return compact ? JSON.stringify(doc) : JSON.stringify(doc, null, 2) + '\n';
}

// ---- the one-line drop-in for an emitter script ----------------------------

const USAGE = `cordon emitter — emit-once command-surface contract.
  <emitter>                print the cordon-v4 contract (stdout)
  <emitter> --write        (re)write the committed contract golden
  <emitter> --check        exit 1 if the committed contract is stale
  <emitter> --compact      with --write/print, use the byte-minimal form`;

/**
 * Drive an emitter script from one declared spec. Resolves the committed
 * contract path (default `<emitter dir>/../contract/<name>.json`), warns on any
 * command that defaulted its effect, then prints / writes / checks per argv.
 *
 * @param {object} spec  the typed surface spec
 * @param {{ url: string, contractPath?: string, argv?: string[] }} opts
 *   `url` is the emitter's import.meta.url (roots the default contract path).
 */
export interface EmitOptions {
  url?: string;
  contractPath?: string;
  argv?: readonly string[];
}

export function emitMain(spec: SurfaceSpec, opts: EmitOptions = {}): void {
  const argv = opts.argv ?? process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  const here = opts.url ? path.dirname(fileURLToPath(opts.url)) : process.cwd();
  const contractPath = opts.contractPath
    ? path.resolve(here, opts.contractPath)
    : path.resolve(here, '..', 'contract', `${spec.name}.json`);

  const undeclared = undeclaredEffects(spec);
  if (undeclared.length > 0) {
    process.stderr.write(
      `cordon: warning: ${undeclared.length} command(s) default to 'read' with no ` +
        `declared effect (a silent fail-open): ${undeclared.join(', ')}. ` +
        `Declare each command's \`effect\` to make the blast radius an explicit choice.\n`,
    );
  }

  const rendered = serialize(renderSurface(spec), { compact: argv.includes('--compact') });

  if (argv.includes('--check')) {
    const committed = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
    if (committed !== rendered) {
      const rel = path.relative(process.cwd(), contractPath);
      process.stderr.write(`cordon: ${rel} is stale — regenerate with \`--write\` and commit.\n`);
      process.exit(1);
    }
    process.stderr.write(`cordon: ${path.relative(process.cwd(), contractPath)} in sync\n`);
  } else if (argv.includes('--write')) {
    fs.mkdirSync(path.dirname(contractPath), { recursive: true });
    fs.writeFileSync(contractPath, rendered);
    process.stderr.write(`cordon: wrote ${path.relative(process.cwd(), contractPath)}\n`);
  } else {
    // bare or --describe: print the contract (the `bin/<tool> --describe` the gate drives).
    process.stdout.write(rendered);
  }
}

export default { renderSurface, describeScripts, undeclaredEffects, serialize, emitMain, EFFECTS, SCHEMA_VERSION };
