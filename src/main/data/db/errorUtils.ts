/**
 * Helpers for classifying SQLite/LibSQL/Drizzle error payloads.
 *
 * Drizzle ORM wraps the underlying driver's errors in a `DrizzleQueryError`
 * whose `message` does NOT include the original constraint text and whose
 * `.cause` carries the real `LibsqlError`. LibsqlError in turn exposes
 * SQLite's extended error codes (e.g. `SQLITE_CONSTRAINT_UNIQUE`) and is
 * itself backed by a native `SqliteError` on some drivers.
 *
 * Matching a plain `e.message.includes('...')` on the outer error therefore
 * misses the wrapped form. These helpers walk the cause chain and look at
 * both `.code` and `.message` at every level.
 */

/** Max chain depth to walk — a safety bound against cyclic `cause` graphs. */
const MAX_CAUSE_DEPTH = 5

function walkCauseChain(e: unknown, predicate: (err: Error) => boolean): boolean {
  let current: unknown = e
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false
    if (predicate(current)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Returns true when the given error (or any error in its `.cause` chain)
 * is a SQLite UNIQUE constraint violation. Works for both the raw libsql
 * error and Drizzle's wrapped form.
 */
export function isUniqueConstraintError(e: unknown): boolean {
  return walkCauseChain(e, (err) => {
    const code = (err as { code?: string }).code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') return true
    return err.message.includes('UNIQUE constraint failed')
  })
}

/**
 * Returns true when the given error (or any error in its `.cause` chain)
 * is a SQLite FOREIGN KEY constraint violation.
 */
export function isForeignKeyConstraintError(e: unknown): boolean {
  return walkCauseChain(e, (err) => {
    const code = (err as { code?: string }).code
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return true
    return err.message.includes('FOREIGN KEY constraint failed')
  })
}
