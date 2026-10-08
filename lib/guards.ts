export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
