// Capability detection — the engine's "respect what's available" layer. A
// registry entry declares `requires: [<capability>...]`; the engine skips it
// fail-soft (status:'skip', with the unmet caps named) when the environment
// can't satisfy it. This is what keeps the default posture lean: an entry that
// needs `playwright` runs only where playwright is actually present, a
// `built-dir` post-build check runs only after a build has produced output, and
// a `macos`-only visual suite never fails a Linux CI runner — it just skips.
//
// Vocabulary:
//   git         the root is a git work tree
//   macos       running on Darwin (committed visual baselines are macOS-rendered)
//   ci          process.env.CI is set (a hosted runner, not an authoring machine)
//   built-dir   a build has emitted a non-empty output dir (see `builtDirs`)
//   <binary>    any other token is an executable name, resolved on PATH and in
//               <root>/node_modules/.bin (so `playwright`/`stylelint`/`tsc`
//               resolve in a node repo without npx). e.g. requires: ['playwright']
//
// Negation: a leading '!' inverts — `requires: ['!ci']` means "only when NOT in
// CI", the portable form of jseverino's `localOnly` (a check of authoring-machine
// sources). `!built-dir`, `!macos`, etc. all work the same way.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// The closed part of the vocabulary; every other token is a binary name. Exported
// so the config schema and docs name them in one place instead of restating.
export const FIXED_CAPABILITIES = ['git', 'macos', 'ci', 'built-dir'];

// The candidate build-output dirs the `built-dir` capability (and the built-tree
// invariants) probe by default. One source, so the capability and the checks
// that depend on it can never disagree about where "the build" is. A repo
// overrides this once via cordon.checks.json `builtDirs`.
export const DEFAULT_BUILT_DIRS = ['dist', 'dist.nosync'];

function isGitWorkTree(root) {
  // Cheap and dependency-free: a .git entry (dir or gitlink file) at the root.
  return fs.existsSync(path.join(root, '.git'));
}

function hasBuiltOutput(root, builtDirs) {
  for (const dir of builtDirs) {
    const abs = path.join(root, dir);
    try {
      if (fs.statSync(abs).isDirectory() && fs.readdirSync(abs).length > 0) return true;
    } catch { /* missing dir — try the next candidate */ }
  }
  return false;
}

// Resolve a binary on PATH or in the repo's node_modules/.bin. Cached per detect()
// so repeated `requires` of the same tool don't re-stat the filesystem.
function makeBinaryResolver(root) {
  const cache = new Map();
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    path.join(root, 'node_modules', '.bin'),
  ];
  return (bin) => {
    if (cache.has(bin)) return cache.get(bin);
    let found = false;
    for (const dir of dirs) {
      for (const candidate of [bin, `${bin}.cmd`, `${bin}.exe`]) {
        try {
          fs.accessSync(path.join(dir, candidate), fs.constants.X_OK);
          found = true;
          break;
        } catch { /* not here */ }
      }
      if (found) break;
    }
    cache.set(bin, found);
    return found;
  };
}

// detect(root, config) -> { has(cap), unmet(requires[]), present() }
//   has(cap)        true iff the (possibly negated) capability holds now
//   unmet(requires) the subset of a requires[] that does NOT hold — what a skip
//                   reports as its reason; an empty array means "run it"
//   present()       the satisfied positive capabilities, for diagnostics
// config: { builtDirs?: string[] } — the candidate build output dirs.
export function detect(root, config = {}) {
  const builtDirs = config.builtDirs ?? DEFAULT_BUILT_DIRS;
  const resolveBinary = makeBinaryResolver(root);

  const positive = (cap) => {
    switch (cap) {
      case 'git': return isGitWorkTree(root);
      case 'macos': return process.platform === 'darwin';
      case 'ci': return Boolean(process.env.CI);
      case 'built-dir': return hasBuiltOutput(root, builtDirs);
      default: return resolveBinary(cap); // any other token is a binary name
    }
  };

  const has = (cap) =>
    cap.startsWith('!') ? !positive(cap.slice(1)) : positive(cap);

  return {
    has,
    unmet: (requires = []) => requires.filter((cap) => !has(cap)),
    present: () => FIXED_CAPABILITIES.filter(positive),
  };
}
