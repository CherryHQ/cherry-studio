/**
 * Row → Entity mapping utilities.
 *
 * See ./README.md for the design rationale (shallow vs. deep null handling,
 * domain optional (?:) vs nullable (| null), no dnull dependency, etc.).
 */

/**
 * Replace top-level `null` values with `undefined`, preserving all other values.
 *
 * This is the canonical bridge between SQLite column NULL and TypeScript
 * optional fields. Shallow by design — nested JSON payloads are NOT touched
 * (see ./README.md: "Why shallow, not recursive").
 *
 * Type-level behavior: fields whose type includes `null` are narrowed to
 * `Exclude<T, null> | undefined`; non-nullable fields (e.g. `notNull()`
 * columns) are passed through unchanged. This matches the runtime: only
 * nullable columns can actually hold NULL.
 */
export function nullsToUndefined<T extends Record<string, unknown>>(
  obj: T
): { [K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K] } {
  const result = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    result[key] = value === null ? undefined : value
  }
  return result as { [K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K] }
}

/**
 * Convert a guaranteed-present timestamp to an ISO string.
 *
 * Use at call sites where the input type is already narrowed to `number | Date`
 * (e.g. `.notNull()` columns). The signature rejects `null | undefined` on
 * purpose: passing them to `new Date(null)` would silently yield the Unix epoch
 * (`"1970-01-01T00:00:00.000Z"`), a classic silent-failure mode. Let the type
 * system stop that at compile time instead.
 *
 * Unlike `timestampToISOOrUndefined`, this helper does NOT treat `0` as falsy —
 * `0` is a valid timestamp (Unix epoch) and is passed through honestly.
 */
export function timestampToISO(value: number | Date): string {
  return new Date(value).toISOString()
}

/**
 * Convert an optional timestamp to an ISO string, preserving absence as
 * `undefined`.
 *
 * Reserved for construction paths where the ENTIRE source row may not exist —
 * not "this column might be null". The audit columns produced by
 * `createUpdateTimestamps` are DB-level `.notNull()`, so a row selected from
 * the DB always has a real value; use `timestampToISO` there.
 *
 * The canonical use case is merging a builtin/preset definition with an
 * optional DB preference row — see `MiniAppService.builtinToMiniApp`.
 */
export function timestampToISOOrUndefined(value: number | Date | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}
