/**
 * Schema-out-of-sync error detection for the v2 migration gate.
 *
 * During v2 development the drizzle migration SQL is disposable — it gets
 * regenerated or deleted freely. When the SQL no longer matches the local
 * database, drizzle re-runs `CREATE TABLE` against objects that already
 * exist and the driver throws `SQLITE_ERROR: ... already exists`.
 * `isSchemaOutOfSyncError` recognizes that specific failure so the gate can
 * show a developer-targeted "reset your local DB" dialog instead of the
 * generic connectivity error. `describeErrorChain` reports the driver reason
 * behind any other migration failure.
 *
 * This file lives inside migration/v2/ so it is removed when migration is
 * deleted.
 */

/** Maximum `.cause` chain depth traversed — guards against cyclic causes. */
const MAX_CAUSE_DEPTH = 5

/**
 * True when `error` (or any error in its `.cause` chain) is a
 * `SQLITE_ERROR` whose message reports an existing schema object
 * (`table` / `index` / `trigger` ... `already exists`).
 *
 * Requiring `code === 'SQLITE_ERROR'` excludes constraint violations, which
 * carry `SQLITE_CONSTRAINT_*` codes — those are never a stale-DB symptom.
 * Drizzle wraps the real error inside an outer `DrizzleQueryError`, so the
 * `.cause` chain is walked rather than inspecting only the top-level error.
 */
export function isSchemaOutOfSyncError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false
    const code = (current as { code?: string }).code
    if (code === 'SQLITE_ERROR' && /already exists/i.test(current.message)) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Flatten an error and its `.cause` chain into one human-readable string,
 * prefixing each link with its SQLite `code` when the driver set one.
 *
 * `DrizzleQueryError.message` is only `Failed query: <sql>` — the driver's
 * actual reason (`SQLITE_BUSY: database is locked`, `SQLITE_FULL: database or
 * disk is full`, `SQLITE_ERROR: index ... already exists`) sits one level down
 * in `.cause`. Reporting `error.message` alone therefore names the statement
 * that failed but never why, which is unusable for both the migration error
 * dialog and the log (winston serializes `message` + `stack`, never `cause`).
 */
export function describeErrorChain(error: unknown): string {
  const links: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) break
    const code = (current as { code?: string }).code
    links.push(code ? `[${code}] ${current.message}` : current.message)
    current = (current as { cause?: unknown }).cause
  }
  return links.length > 0 ? links.join('\ncaused by: ') : String(error)
}
