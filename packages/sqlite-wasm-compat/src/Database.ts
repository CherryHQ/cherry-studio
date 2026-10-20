import type { Database as Oo1Database, SqlValue } from '@sqlite.org/sqlite-wasm'

import { getSqlite } from './sqlite'
import { SqliteError, toSqliteError } from './SqliteError'
import { Statement, StatementCache } from './Statement'

export interface DatabaseOptions {
  /** sqlite-wasm VFS to open the file with, e.g. `opfs` in a cross-origin-isolated Worker. */
  vfs?: string
  /** Maximum number of prepared statements kept alive for reuse. */
  statementCacheSize?: number
}

export interface FunctionOptions {
  deterministic?: boolean
  varargs?: boolean
  directOnly?: boolean
}

type TransactionBehavior = 'deferred' | 'immediate' | 'exclusive'

export type Transaction<F extends (...args: any[]) => any> = F & {
  deferred: F
  immediate: F
  exclusive: F
  default: F
}

const isThenable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function'

/**
 * Synchronous better-sqlite3-compatible connection over sqlite-wasm's oo1 API,
 * so `drizzle-orm/better-sqlite3` and the data layer run unchanged on it.
 *
 * Unlike sqlite-wasm's defaults it enables foreign keys on open, matching
 * better-sqlite3; without that the schema's ON DELETE actions silently stop firing.
 */
export class Database {
  static readonly SqliteError = SqliteError

  readonly name: string
  readonly memory: boolean
  readonly #db: Oo1Database
  readonly #statements: StatementCache
  #savepointDepth = 0

  constructor(filename = ':memory:', options: DatabaseOptions = {}) {
    this.name = filename
    this.memory = filename === ':memory:' || filename === ''
    try {
      this.#db = new (getSqlite().oo1.DB)({ filename, flags: 'c', vfs: options.vfs })
    } catch (error) {
      throw toSqliteError(error)
    }
    this.#statements = new StatementCache(this.#db, options.statementCacheSize ?? 256)
    this.exec('PRAGMA foreign_keys = ON')
  }

  get open(): boolean {
    return this.#db.isOpen()
  }

  get inTransaction(): boolean {
    return this.open && getSqlite().capi.sqlite3_get_autocommit(this.#db) === 0
  }

  prepare(source: string): Statement {
    return new Statement(this.#db, this.#statements, source)
  }

  exec(source: string): this {
    try {
      this.#db.exec(source)
    } catch (error) {
      throw toSqliteError(error)
    }
    return this
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.prepare(`PRAGMA ${source}`).all() as Record<string, SqlValue>[]
    if (!options.simple) return rows
    return rows.length > 0 ? Object.values(rows[0])[0] : undefined
  }

  function(name: string, fn: (...args: any[]) => SqlValue): this
  function(name: string, options: FunctionOptions, fn: (...args: any[]) => SqlValue): this
  function(
    name: string,
    optionsOrFn: FunctionOptions | ((...args: any[]) => SqlValue),
    maybeFn?: (...args: any[]) => SqlValue
  ): this {
    const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn!
    const options = typeof optionsOrFn === 'function' ? {} : optionsOrFn
    this.#db.createFunction({
      name,
      arity: options.varargs ? -1 : fn.length,
      deterministic: options.deterministic,
      directOnly: options.directOnly,
      // oo1 passes the sqlite3_context pointer first; better-sqlite3 callbacks get only the arguments.
      xFunc: (...call: [number, ...SqlValue[]]) => fn(...call.slice(1))
    })
    return this
  }

  /**
   * better-sqlite3 transaction semantics: BEGIN on the outermost call, SAVEPOINT
   * when nested, rollback on throw, and a TypeError for async callbacks because
   * the transaction would commit before the awaited work ran.
   */
  transaction<F extends (...args: any[]) => any>(fn: F): Transaction<F> {
    const run =
      (behavior: TransactionBehavior) =>
      (...args: Parameters<F>): ReturnType<F> =>
        this.inTransaction ? this.#runNested(fn, args) : this.#runOutermost(behavior, fn, args)
    const deferred = run('deferred') as F
    return Object.assign(deferred, {
      deferred,
      immediate: run('immediate') as F,
      exclusive: run('exclusive') as F,
      default: deferred
    })
  }

  close(): this {
    if (this.open) {
      this.#statements.clear()
      this.#db.close()
    }
    return this
  }

  #runOutermost<F extends (...args: any[]) => any>(behavior: TransactionBehavior, fn: F, args: unknown[]) {
    this.exec(`BEGIN ${behavior.toUpperCase()}`)
    try {
      const result = fn(...args)
      if (isThenable(result)) throw new TypeError('Transaction function cannot return a promise')
      this.exec('COMMIT')
      return result
    } catch (error) {
      if (this.inTransaction) this.exec('ROLLBACK')
      throw error
    }
  }

  #runNested<F extends (...args: any[]) => any>(fn: F, args: unknown[]) {
    const savepoint = `compat_sp_${++this.#savepointDepth}`
    this.exec(`SAVEPOINT ${savepoint}`)
    try {
      const result = fn(...args)
      if (isThenable(result)) throw new TypeError('Transaction function cannot return a promise')
      this.exec(`RELEASE ${savepoint}`)
      return result
    } catch (error) {
      if (this.inTransaction) {
        this.exec(`ROLLBACK TO ${savepoint}`)
        this.exec(`RELEASE ${savepoint}`)
      }
      throw error
    } finally {
      this.#savepointDepth--
    }
  }
}
