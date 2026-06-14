// internal-links — a portable invariant over a built HTML tree, graduated from
// jseverino.com's check-links.mjs. The sitemap proves every page exists; this
// proves every internal reference *inside* the pages (href, src, poster, and
// each srcset candidate, including same-origin absolute URLs like the canonical
// link) resolves to a file the build emitted. A typo'd in-content link fails
// here, before deploy, instead of surfacing in the live traversal after.
//
// `requires: ['built-dir']`, `phase: 'post-build'`. The two repo-specific seams
// — the production origin to treat as same-site, and the route prefixes served
// dynamically rather than by emitted files — are config, so the rule is portable.
import fs from 'node:fs';
import path from 'node:path';
import { builtHtmlPages } from './built-tree.mjs';
import { defaultsOf } from './config.mjs';

const configSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Internal link integrity over the built HTML. Universal rule; the two seams below adapt it to a site.',
  properties: {
    origin: {
      type: ['string', 'null'],
      default: null,
      description: 'Production origin (e.g. "https://example.com") to treat as same-site, so absolute canonical/og URLs are resolved against the build. null leaves external origins out of scope.',
    },
    dynamicRoutePrefixes: {
      type: 'array',
      items: { type: 'string' },
      default: ['/api/', '/cdn-cgi/'],
      description: 'Path prefixes served by functions/proxies, not emitted files — references under them are allowlisted instead of resolved on disk.',
    },
  },
};

const DEFAULTS = defaultsOf(configSchema);

// Normalize a reference to a root-relative pathname, or null when out of scope
// (external origin, mailto:/data:, protocol-relative, fragment-only).
function internalPathname(reference, pageDir, origin) {
  let value = reference.trim();
  if (!value || value.startsWith('#')) return null;
  if (origin && value.startsWith(origin)) value = value.slice(origin.length) || '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;

  const withoutSuffix = value.split('#')[0].split('?')[0];
  if (!withoutSuffix) return null;

  const resolved = withoutSuffix.startsWith('/')
    ? withoutSuffix
    : `/${path.posix.join(pageDir, withoutSuffix)}`;
  try {
    return decodeURI(resolved);
  } catch {
    return resolved;
  }
}

function resolvesInDist(distDir, pathname, dynamicPrefixes) {
  if (dynamicPrefixes.some((prefix) => pathname.startsWith(prefix))) return true;
  const target = path.join(distDir, pathname);
  if (pathname.endsWith('/')) return fs.existsSync(path.join(target, 'index.html'));
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return true;
  return fs.existsSync(path.join(target, 'index.html'));
}

export default {
  id: 'internal-links',
  name: 'Internal Link Integrity',
  effect: 'read',
  requires: ['built-dir'],
  phase: 'post-build',
  gates: ['check'],
  configSchema,
  fix: 'A built page references an internal URL or asset the build did not emit. '
    + 'Fix the link at the reported page, or restore the missing target. Add a '
    + 'functions/proxy route to `dynamicRoutePrefixes` if it is served, not emitted.',

  run({ root, builtDirs, config = {} }) {
    const cfg = { ...DEFAULTS, ...config };
    const built = builtHtmlPages(root, builtDirs);
    if (built.skipped) return built;
    const { distDir, pages } = built;

    const failures = [];
    let referenceCount = 0;
    const checked = new Map();

    for (const file of pages) {
      const html = fs.readFileSync(file, 'utf8');
      const rel = path.relative(distDir, file);
      const pageDir = path.posix.dirname(`/${rel.split(path.sep).join('/')}`);

      const references = [];
      for (const m of html.matchAll(/(?:href|src|poster)=["']([^"']+)["']/g)) references.push(m[1]);
      for (const m of html.matchAll(/srcset=["']([^"']+)["']/g)) {
        for (const candidate of m[1].split(',')) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) references.push(url);
        }
      }

      for (const reference of references) {
        const pathname = internalPathname(reference, pageDir, cfg.origin);
        if (!pathname) continue;
        referenceCount += 1;
        if (!checked.has(pathname)) checked.set(pathname, resolvesInDist(distDir, pathname, cfg.dynamicRoutePrefixes));
        if (!checked.get(pathname)) failures.push(`${rel}: ${reference}`);
      }
    }

    return failures.length
      ? { ok: false, detail: failures.map((f) => `- ${f}`).join('\n') }
      : { ok: true, detail: `${pages.length} pages, ${referenceCount} internal references (${checked.size} unique) resolve` };
  },
};
