/**
 * Shared errno extraction helpers for the path-status utilities.
 *
 * `pathStatus.ts` (async, `fs.stat`-backed, general arbitrary-path queries) and
 * `workspacePathStatus.ts` (sync, `fs.statSync`-backed, scoped to validating a
 * workspace root) both classify caught FS errors into a typed status reason.
 * They stay separate because one is async and the other must run synchronously
 * from sync call sites, so they can't be merged wholesale — but the errno→string
 * extraction is identical, so it lives here and both import it.
 */

/** The NodeJS errno `code` (e.g. `'ENOENT'`), or undefined when the error carries none. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

/** A human-readable message for the caught error, used to populate `detail`. */
export function errorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : String(error)
}
