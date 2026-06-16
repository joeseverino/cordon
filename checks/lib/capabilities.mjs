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
//   file:<p>    a path (file or dir) exists at <root>/<p> — the stack marker
//               auto-detection turns on: ['file:uv.lock'] lights a check up only
//               in a uv repo, ['file:manage.py'] only in a Django one. The
//               repo-shaped sibling of a binary probe.
//   glob:<g>    at least one path matches the glob under <root>, ignoring
//               node_modules/ and .git/ — ['glob:**/*.sh'] means "this repo has
//               shell scripts", ['glob:playwright.config.*'] a playwright one.
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

// `file:<p>` — a stack marker exists at the root (file or dir). A relative path,
// never escaping the root (a leading '/' or '..' segment can't reach outside).
function markerExists(root, rel) {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;
  return fs.existsSync(abs);
}

// `glob:<g>` — at least one path under the root matches, with node_modules/ and
// .git/ pruned so a dependency's vendored shell scripts never make a repo look
// like it "has shell scripts". Returns on the first hit (globSync is eager, so
// the exclude is what keeps it cheap).
function globMatches(root, pattern) {
  try {
    for (const _ of fs.globSync(pattern, {
      cwd: root,
      exclude: (p) => p === 'node_modules' || p === '.git'
        || p.includes(`${path.sep}node_modules`) || p.startsWith('node_modules'),
    })) {
      return true;
    }
    return false;
  } catch { return false; }
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
    if (cap.startsWith('file:')) return markerExists(root, cap.slice(5));
    if (cap.startsWith('glob:')) return globMatches(root, cap.slice(5));
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
