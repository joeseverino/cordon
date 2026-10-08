import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

// Assertions are evaluated while a scratch fixture is alive, then registered as
// subtests once it has been cleaned up.
export function collector() {
  const rows: { name: string; cond: unknown; detail: unknown }[] = [];
  return {
    check(name: string, cond: unknown, detail: unknown = ''): void {
      rows.push({ name, cond, detail });
    },
    async report(t: TestContext): Promise<void> {
      for (const row of rows) {
        await t.test(row.name, () => {
          assert.ok(row.cond, row.detail ? String(row.detail) : row.name);
        });
      }
    },
  };
}
