/**
 * SQLite constraint error → DataApiError translation layer.
 *
 * Drizzle ORM wraps the underlying libsql error in a `DrizzleQueryError` whose
 * `.message` reads "Failed query: insert into ..." and whose `.cause` carries
 * the real libsql error (with `code` such as `SQLITE_CONSTRAINT_UNIQUE`).
 * Sometimes the chain is one level deeper on top of a native `SqliteError`.
 * Matching `e.message` on the outer error alone therefore misses the wrapped
 * form — every helper here walks the `.cause` chain.
 *
 * ---
 *
 * ## Discipline: do not replace pre-validation
 *
 * `withSqliteErrors` handlers are **TOCTOU / concurrency fallbacks**, not a
 * replacement for application-level pre-validation. The business main path for
 * any UNIQUE / FK constraint should have an explicit `assertXxxAvailable`
 * pre-query. The default messages from `defaultHandlersFor` are intentionally
 * terse — they are meant to surface "something raced with us" rather than to
 * be the first-class user message. Service code that uses SQLite constraint
 * errors as a stand-in for real validation will slowly lose pre-check
 * discipline; avoid that trap.
 *
 * ## Positioning: local optimum, not industry standard
 *
 * The "sparse-handler map + structural rethrow" shape here is **not** an
 * industry best practice. Mainstream approaches — Spring/Rails typed exception
 * hierarchies, Prisma's `error.code` switch, NestJS exception filters — each
 * make different trade-offs. This module's specific value is eliminating the
 * "forgot to rethrow" bug class at the type layer, which matters in Cherry
 * Studio's direct-db-access Service pattern where no IoC/AOP framework can
 * catch misses. If future Cherry Studio architecture adopts such a framework,
 * revisit whether a typed exception hierarchy is a better fit.
 */

import { loggerService } from '@logger'
import type { DataApiError } from '@shared/data/api'
import { DataApiErrorFactory } from '@shared/data/api'

const logger = loggerService.withContext('sqliteErrors')

/**
 * Maximum `.cause` chain depth traversed by `walkCauseChain`. Guards against
 * cyclic cause graphs and bounds classification cost.
 */
const MAX_CAUSE_DEPTH = 5

/**
 * Classification of a SQLite constraint violation. A discriminated union so
 * callers can `switch` exhaustively when needed.
 *
 * `columns` / `constraintName` are parsed from the SQLite error message and
 * are **informational only** — they may be empty/undefined when the driver
 * emits an atypical format. Do not rely on them for business-critical
 * branching; use them for logging and for lightweight message refinement
 * (e.g. distinguishing single-column UNIQUEs in a multi-unique table).
 */
export type SqliteConstraint =
  | { kind: 'unique'; columns: string[] }
  | { kind: 'foreign_key' }
  | { kind: 'check'; constraintName?: string }
  | { kind: 'not_null'; columns: string[] }

/**
 * Handlers that translate a classified SQLite constraint into a DataApiError.
 *
 * All keys are optional. Any constraint type without a matching handler is
 * **rethrown unchanged** — this is the "structural rethrow" guarantee that
 * makes "forgot to handle" and "forgot to rethrow" impossible to write.
 *
 * Because all keys are optional, a typo (e.g. `unqiue` instead of `unique`)
 * would silently fall through to the rethrow branch. Always append
 * `satisfies SqliteErrorHandlers` to the handlers object literal so the
 * TypeScript compiler catches such typos:
 *
 * ```ts
 * await withSqliteErrors(op, {
 *   unique: () => DataApiErrorFactory.conflict(...),
 * } satisfies SqliteErrorHandlers)
 * ```
 */
export type SqliteErrorHandlers = {
  unique?: (columns: string[]) => DataApiError
  foreignKey?: () => DataApiError
  check?: (constraintName?: string) => DataApiError
  notNull?: (columns: string[]) => DataApiError
}

/**
 * Walk the `.cause` chain of `err`, yielding each `Error` encountered up to
 * `MAX_CAUSE_DEPTH` levels. Stops when a non-Error is reached. Internal helper.
 */
function* walkCauseChain(err: unknown): Generator<Error> {
  let current: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return
    yield current
    current = (current as { cause?: unknown }).cause
  }
}

/**
 * Parse column names from a SQLite constraint message of the form
 * `"<PREFIX> constraint failed: table.col1, table.col2"`.
 *
 * For composite UNIQUE / NOT NULL constraints the returned array contains
 * **all** participating columns — callers that want to branch on a specific
 * column must check `columns.length === 1 && columns[0] === target`, not
 * `columns.includes(target)` (which would false-positive on composite
 * violations). Returns `[]` when the message is unparseable. Internal helper.
 */
function parseConstraintColumns(message: string, prefix: 'UNIQUE' | 'NOT NULL'): string[] {
  const marker = `${prefix} constraint failed: `
  const idx = message.indexOf(marker)
  if (idx === -1) return []
  return message
    .slice(idx + marker.length)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Extract the optional named CHECK constraint identifier from a SQLite error
 * message of the form `"CHECK constraint failed: <name>"`. Internal helper.
 */
function extractCheckName(message: string): string | undefined {
  const match = message.match(/CHECK constraint failed: (\w+)/)
  return match?.[1]
}

/**
 * Walk the error's `.cause` chain and classify the innermost SQLite
 * constraint violation. Returns `null` when no level in the chain is a
 * recognized SQLite constraint — for such errors callers should rethrow
 * unchanged (`withSqliteErrors` does this automatically).
 *
 * The SQLite extended error codes (`SQLITE_CONSTRAINT_UNIQUE` etc.) are the
 * authoritative classification signal. A message-substring fallback handles
 * older libsql releases that may not set `.code`; when the fallback fires we
 * emit a warning log so driver drift becomes visible.
 *
 * @example
 * ```ts
 * const kind = classifySqliteError(e)
 * if (kind?.kind === 'unique') { ... }
 * ```
 */
export function classifySqliteError(e: unknown): SqliteConstraint | null {
  for (const err of walkCauseChain(e)) {
    const code = (err as { code?: string }).code
    const message = err.message

    // PRIMARYKEY and ROWID constraints are semantically UNIQUE violations —
    // SQLite reports them with distinct extended codes but the same
    // "UNIQUE constraint failed: ..." message text.
    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      code === 'SQLITE_CONSTRAINT_ROWID'
    ) {
      return { kind: 'unique', columns: parseConstraintColumns(message, 'UNIQUE') }
    }
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return { kind: 'foreign_key' }
    }
    if (code === 'SQLITE_CONSTRAINT_NOTNULL') {
      return { kind: 'not_null', columns: parseConstraintColumns(message, 'NOT NULL') }
    }
    if (code === 'SQLITE_CONSTRAINT_CHECK') {
      return { kind: 'check', constraintName: extractCheckName(message) }
    }

    // Message-substring fallback for drivers that do not set `.code`.
    if (message.includes('UNIQUE constraint failed')) {
      logger.warn('classifySqliteError fell back to message match for UNIQUE', { message })
      return { kind: 'unique', columns: parseConstraintColumns(message, 'UNIQUE') }
    }
    if (message.includes('FOREIGN KEY constraint failed')) {
      logger.warn('classifySqliteError fell back to message match for FOREIGN KEY', { message })
      return { kind: 'foreign_key' }
    }
    if (message.includes('NOT NULL constraint failed')) {
      logger.warn('classifySqliteError fell back to message match for NOT NULL', { message })
      return { kind: 'not_null', columns: parseConstraintColumns(message, 'NOT NULL') }
    }
    if (message.includes('CHECK constraint failed')) {
      logger.warn('classifySqliteError fell back to message match for CHECK', { message })
      return { kind: 'check', constraintName: extractCheckName(message) }
    }
  }
  return null
}

/**
 * Run `operation` and translate any recognized SQLite constraint violation
 * into a `DataApiError` via the matching handler.
 *
 * Three structural guarantees:
 *
 * 1. **Matched constraint + matching handler** → the handler's `DataApiError`
 *    is thrown.
 * 2. **Matched constraint but no matching handler** → the original error is
 *    rethrown unchanged. The reference, stack, and `.cause` chain are
 *    preserved.
 * 3. **Non-SQLite error** → the original error is rethrown unchanged.
 *
 * The rethrow branches are built into the control flow, so "forgot to
 * rethrow" is not representable in client code. Handlers must be
 * synchronous — they construct error objects, not perform I/O.
 *
 * Because `SqliteErrorHandlers` keys are all optional, append
 * `satisfies SqliteErrorHandlers` to the handlers literal so TypeScript
 * catches misspelled keys:
 *
 * ```ts
 * await withSqliteErrors(
 *   () => this.db.insert(tagTable).values(dto).returning(),
 *   {
 *     unique: () => DataApiErrorFactory.conflict(
 *       `Tag '${dto.name}' already exists`, 'Tag'
 *     ),
 *   } satisfies SqliteErrorHandlers
 * )
 * ```
 *
 * For the common case use `defaultHandlersFor` which provides sensible
 * defaults for all four constraint kinds.
 */
export async function withSqliteErrors<T>(operation: () => Promise<T>, handlers: SqliteErrorHandlers): Promise<T> {
  try {
    return await operation()
  } catch (e) {
    const classification = classifySqliteError(e)
    if (!classification) throw e

    switch (classification.kind) {
      case 'unique':
        if (handlers.unique) throw handlers.unique(classification.columns)
        break
      case 'foreign_key':
        if (handlers.foreignKey) throw handlers.foreignKey()
        break
      case 'check':
        if (handlers.check) throw handlers.check(classification.constraintName)
        break
      case 'not_null':
        if (handlers.notNull) throw handlers.notNull(classification.columns)
        break
    }
    throw e
  }
}

/**
 * Build a complete `SqliteErrorHandlers` set with sensible defaults for the
 * common CRUD case. Spread the result to override any specific handler.
 *
 * Default mappings:
 *   - UNIQUE     → `conflict("<resource> '<id>' already exists")`
 *   - FOREIGN KEY → `notFound(resource, identifier)` — **insert semantics**:
 *                   "the parent row referenced by this operation does not
 *                   exist". If the caller is performing a delete that may
 *                   fail due to `ON DELETE RESTRICT` (the opposite semantics
 *                   — "still referenced by children"), override `foreignKey`
 *                   with `invalidOperation`.
 *   - CHECK      → `validation` at the `_root` field with the constraint name
 *                   if available.
 *   - NOT NULL   → `validation` with each violated column mapped to a
 *                   field-level error.
 *
 * @param resource   Plain resource name, no quotes (e.g. `'Tag'`, `'MiniApp'`).
 * @param identifier Plain identifier value, no quotes (e.g. the name or id).
 *
 * @example
 * ```ts
 * // Simple case — one-line handlers
 * await withSqliteErrors(
 *   () => this.db.insert(tagTable).values(dto).returning(),
 *   defaultHandlersFor('Tag', dto.name)
 * )
 *
 * // Override a specific kind
 * await withSqliteErrors(op, {
 *   ...defaultHandlersFor('Tag', id),
 *   foreignKey: () => DataApiErrorFactory.invalidOperation(
 *     `Cannot delete Tag '${id}': still referenced`
 *   ),
 * } satisfies SqliteErrorHandlers)
 * ```
 */
export function defaultHandlersFor(resource: string, identifier: string): SqliteErrorHandlers {
  return {
    unique: () => DataApiErrorFactory.conflict(`${resource} '${identifier}' already exists`, resource),
    foreignKey: () => DataApiErrorFactory.notFound(resource, identifier),
    check: (constraintName) => {
      const detail = constraintName
        ? `${resource} '${identifier}' failed CHECK constraint '${constraintName}'`
        : `${resource} '${identifier}' failed a CHECK constraint`
      return DataApiErrorFactory.validation({ _root: [detail] }, detail)
    },
    notNull: (columns) => {
      const fieldErrors: Record<string, string[]> =
        columns.length > 0
          ? Object.fromEntries(columns.map((col) => [col, ['is required']]))
          : { _root: [`${resource} '${identifier}' is missing a required field`] }
      const message =
        columns.length > 0
          ? `${resource} '${identifier}' missing required field${columns.length > 1 ? 's' : ''}: ${columns.join(', ')}`
          : `${resource} '${identifier}' is missing a required field`
      return DataApiErrorFactory.validation(fieldErrors, message)
    }
  }
}
