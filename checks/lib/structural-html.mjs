// structural-html — a portable invariant over a built HTML tree, graduated from
// jseverino.com's check-html.mjs. Two byte-level rules every site shares, the
// static all-pages complement to a browser accessibility sweep:
//
//   • no duplicate id on a page (breaks fragment links, label association, and
//     aria-* references silently)
//   • every <img> carries an alt attribute (empty alt is valid — it marks a
//     decorative image — but a missing attribute is always an authoring bug)
//
// Universal and config-free; it needs only a build to inspect, so it declares
// `requires: ['built-dir']` and `phase: 'post-build'`. Absent a build it skips
// fail-soft (the engine won't even reach it unless built-dir is satisfied).
import fs from 'node:fs';
import path from 'node:path';
import { builtHtmlPages } from './built-tree.mjs';

export default {
  id: 'structural-html',
  name: 'Structural HTML',
  effect: 'read',
  requires: ['built-dir'],
  phase: 'post-build',
  gates: ['check'],
  fix: 'A built page repeats an id or ships an <img> without alt. Fix the '
    + 'component or content at the reported page; decorative images use alt="", '
    + 'never a missing attribute. The detail lists each offending page.',

  run({ root, builtDirs }) {
    const built = builtHtmlPages(root, builtDirs);
    if (built.skipped) return built;
    const { distDir, pages } = built;

    const problems = [];
    let idCount = 0;
    let imgCount = 0;

    for (const file of pages) {
      const html = fs.readFileSync(file, 'utf8');
      const rel = path.relative(distDir, file);

      const seen = new Map();
      for (const m of html.matchAll(/<[a-zA-Z][^>]*\sid="([^"]*)"/g)) {
        idCount += 1;
        seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
      }
      for (const [id, count] of seen) {
        if (count > 1) problems.push(`${rel}: id "${id}" appears ${count} times`);
      }

      for (const m of html.matchAll(/<img\b[^>]*>/g)) {
        imgCount += 1;
        if (!/\salt=/.test(m[0])) problems.push(`${rel}: <img> without alt (${m[0].slice(0, 80)}…)`);
      }
    }

    return problems.length
      ? { ok: false, detail: problems.map((p) => `- ${p}`).join('\n') }
      : { ok: true, detail: `${pages.length} pages: ${idCount} ids unique per page, ${imgCount} images all carry alt` };
  },
};
