// pyproject.mjs — a tiny, dependency-free reader for the two facts cordon's
// Python catalog derives behavior from: the interpreter versions a package
// declares support for, and the optional-dependency groups it ships. Line-based
// TOML scanning (the same approach version-align.mjs uses), so there's no toml
// dependency and the engine stays zero-dep.
//
// The supported versions come from the canonical place a Python package already
// declares them — `[project].classifiers` `Programming Language :: Python :: 3.x`
// — so the `pytest` matrix is "auto-on from what you already wrote": list three
// classifiers, get three-version coverage; list one, get one. The extras let the
// matrix install the test deps from a `dev` group when present, matching the
// gate's `uv sync --extra dev` convention.
import fs from 'node:fs';
import path from 'node:path';

// Parse the [project] table for version classifiers and the
// [project.optional-dependencies] table for extra-group names. A table header is
// a line that *starts* with `[` (so an array's `classifiers = [` / closing `]`
// inside a value are never mistaken for one). Pure and string-only, for testing.
export function parsePyproject(text) {
  let table = null;
  const projectLines = [];
  const extras = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]/);
    if (header) { table = header[1]; continue; }
    if (table === 'project') {
      projectLines.push(line);
    } else if (table === 'project.optional-dependencies') {
      const m = line.match(/^([A-Za-z0-9._-]+)\s*=/);
      if (m) extras.push(m[1]);
    }
  }
  const versions = [...new Set(
    projectLines.flatMap((l) => {
      const m = l.match(/Python :: (3\.\d+)\b/);
      return m ? [m[1]] : [];
    }),
  )].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  return { versions, extras };
}

// Read <root>/pyproject.toml and parse it; a missing/unreadable file is "nothing
// declared" (empty), so a caller never has to guard the read.
export function readPyproject(root) {
  try {
    return parsePyproject(fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8'));
  } catch {
    return { versions: [], extras: [] };
  }
}
