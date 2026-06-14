// Shared plumbing for the post-build invariants (internal-links, structural-html):
// resolve the build's output dir from the same candidate list the `built-dir`
// capability uses, walk it, and collect the emitted HTML. Graduated from
// jseverino.com/tests/audits/lib.mjs, with the one repo-specific dependency — the
// outDir decision — turned into a `builtDirs` config seam so it runs in any repo.
//
// These invariants declare `requires: ['built-dir']`, so the engine only runs
// them when a build has produced output; still, resolveBuiltDir returns null
// (never throws) so a check called directly degrades to a clean skip, not a crash.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILT_DIRS } from './capabilities.mjs';

// First candidate dir under root that exists and holds files, or null.
export function resolveBuiltDir(root, builtDirs = DEFAULT_BUILT_DIRS) {
  for (const dir of builtDirs) {
    const abs = path.join(root, dir);
    try {
      if (fs.statSync(abs).isDirectory() && fs.readdirSync(abs).length > 0) return abs;
    } catch { /* missing — try the next candidate */ }
  }
  return null;
}

export function walkFiles(dir, predicate = () => true, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, files);
    else if (predicate(entry.name)) files.push(full);
  }
  return files;
}

// { distDir, pages } for the built HTML, or { skipped, detail } when there is no
// usable build output — the engine renders that as a fail-soft skip.
export function builtHtmlPages(root, builtDirs = DEFAULT_BUILT_DIRS) {
  const distDir = resolveBuiltDir(root, builtDirs);
  if (!distDir) {
    return { skipped: true, detail: `no build output in ${builtDirs.join(' / ')} — run the build first` };
  }
  const pages = walkFiles(distDir, (name) => name.endsWith('.html'));
  if (pages.length === 0) {
    return { skipped: true, detail: `no HTML pages under ${path.relative(root, distDir)} — the build emitted nothing` };
  }
  return { distDir, pages };
}
