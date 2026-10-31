import type { BindableValue, Database as Oo1Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm'

import { getSqlite } from './sqlite'
import { toSqliteError } from './SqliteError'

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface ColumnDefinition {
  name: string
}

/**
 * Prepared statements keyed by SQL text. Drizzle prepares a fresh statement for
 * every query, and oo1 statements live in wasm memory until finalized, so
 * reusing them by source keeps memory bounded.
 */
export class StatementCache {
  readonly #db: Oo1Database
  readonly #capacity: number
  readonly #entries = new Map<string, PreparedStatement>()

  constructor(db: Oo1Database, capacity: number) {
    this.#db = db
    this.#capacity = capacity
  }

  acquire(source: string): PreparedStatement {
    let stmt = this.#entries.get(source)
    if (stmt) {
      this.#entries.delete(source)
    } else {
      stmt = this.#db.prepare(source)
      if (this.#entries.size >= this.#capacity) {
        const [oldest, evicted] = this.#entries.entries().next().value!
        this.#entries.delete(oldest)
        evicted.finalize()
      }
    }
    this.#entries.set(source, stmt)
    return stmt
  }

  clear(): void {
    for (const stmt of this.#entries.values()) stmt.finalize()
    this.#entries.clear()
  }
}

type Row = Record<string, SqlValue>

/** better-sqlite3 `Statement` surface used by Drizzle and the data layer. */
export class Statement {
  readonly source: string
  readonly reader: boolean
  readonly #db: Oo1Database
  readonly #cache: StatementCache
  #raw = false
  #pluck = false

  constructor(db: Oo1Database, cache: StatementCache, source: string) {
    this.#db = db
    this.#cache = cache
    this.source = source
    this.reader = this.#call(() => this.#cache.acquire(source).columnCount > 0)
  }

  raw(toggle = true): this {
    this.#raw = toggle
    if (toggle) this.#pluck = false
    return this
  }

  pluck(toggle = true): this {
    this.#pluck = toggle
    if (toggle) this.#raw = false
    return this
  }

  columns(): ColumnDefinition[] {
    return this.#cache
      .acquire(this.source)
      .getColumnNames()
      .map((name) => ({ name }))
  }

  run(...params: unknown[]): RunResult {
    return this.#execute(params, (stmt) => {
      while (stmt.step());
      const { capi } = getSqlite()
      const rowid = capi.sqlite3_last_insert_rowid(this.#db)
      return {
        changes: capi.sqlite3_changes(this.#db),
        lastInsertRowid: Number.isSafeInteger(Number(rowid)) ? Number(rowid) : rowid
      }
    })
  }

  get(...params: unknown[]): unknown {
    return this.#execute(params, (stmt) => (stmt.step() ? this.#row(stmt) : undefined))
  }

  all(...params: unknown[]): unknown[] {
    return this.#execute(params, (stmt) => {
      const rows: unknown[] = []
      while (stmt.step()) rows.push(this.#row(stmt))
      return rows
    })
  }

  *iterate(...params: unknown[]): IterableIterator<unknown> {
    yield* this.all(...params)
  }

  #row(stmt: PreparedStatement): unknown {
    if (this.#pluck) return stmt.get(0)
    return this.#raw ? stmt.get([]) : stmt.get({} as Row)
  }

  #execute<T>(params: unknown[], body: (stmt: PreparedStatement) => T): T {
    return this.#call(() => {
      const stmt = this.#cache.acquire(this.source)
      try {
        bind(stmt, params)
        return body(stmt)
      } finally {
        stmt.reset(true)
      }
    })
  }

  #call<T>(fn: () => T): T {
    try {
      return fn()
    } catch (error) {
      throw toSqliteError(error)
    }
  }
}

const isNamedParams = (value: unknown): value is Record<string, BindableValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value)

/** better-sqlite3 accepts positional args, arrays of them, and one object of named params (keys without the `@`/`:`/`$`). */
function bind(stmt: PreparedStatement, params: unknown[]): void {
  if (params.length === 0) return
  const positional: unknown[] = []
  let named: Record<string, BindableValue> | undefined
  for (const param of params) {
    if (Array.isArray(param)) positional.push(...param)
    else if (isNamedParams(param)) named = param
    else positional.push(param)
  }
  if (!named) {
    stmt.bind(positional as BindableValue[])
    return
  }
  const { capi } = getSqlite()
  let next = 0
  for (let index = 1; index <= stmt.parameterCount; index++) {
    const name = capi.sqlite3_bind_parameter_name(stmt, index)
    stmt.bind(index, (name ? named[name.slice(1)] : positional[next++]) as SqlValue)
  }
}
