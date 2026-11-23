// Type guards for reading untrusted JSON (files, API responses, SDK payloads).
// Part of the shared vocabulary: pure, dependency-free, usable from any module.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as a record, or an empty record, so nested fields can be read without checks at every level. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
