// Where cordon lives, for code that runs from source (`<root>/checks/run.ts`)
// and from the build (`<root>/dist/checks/run.js`) alike. Assets (schema/,
// fixtures/, checks/config.schema.json, shell scripts) exist only in the source
// tree, so they resolve from CORDON_ROOT; a cordon script spawned by another is
// resolved with cordonScript(), which keeps to the running kind — `.ts` beside
// source, `.js` under dist/.
import fs from 'node:fs';
import path from 'node:path';

// The nearest directory at or above `from` holding schema/cordon-v4.json.
export function findCordonRoot(from: string = import.meta.dirname): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'schema', 'cordon-v4.json'))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`cordon: no schema/cordon-v4.json above ${from}`);
  }
}

export const CORDON_ROOT = findCordonRoot();

// This module sits at <code>/lib/root.{ts,js}: <code> is the source root or dist/.
const CODE_ROOT = path.resolve(import.meta.dirname, '..');
const EXT = path.extname(import.meta.filename);

// A cordon script by its extensionless path from the root, e.g.
// cordonScript('conformance/validate') -> <root>/conformance/validate.ts from
// source, <root>/dist/conformance/validate.js from the build.
export const cordonScript = (rel: string): string => path.join(CODE_ROOT, `${rel}${EXT}`);

// A cordon-owned asset by its path from the root (schema/, fixtures/, …).
export const cordonAsset = (...rel: string[]): string => path.join(CORDON_ROOT, ...rel);
