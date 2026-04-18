/**
 * Strip null values from an object, converting them to undefined.
 * This bridges the gap between SQLite NULL and TypeScript optional fields.
 */
export function stripNulls<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], null> } {
  const result = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    // null → undefined at runtime; type-level Exclude<T[K], null> is
    // intentionally optimistic — callers should handle optional fields
    result[key] = value === null ? undefined : value
  }
  return result as { [K in keyof T]: Exclude<T[K], null> }
}
