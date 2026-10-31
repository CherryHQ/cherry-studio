import init, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm'

let instance: Sqlite3Static | undefined
let loading: Promise<Sqlite3Static> | undefined

/**
 * Loads the sqlite-wasm module once per realm. `Database` is synchronous like
 * better-sqlite3, so callers must await this before the first `new Database()`.
 */
export function loadSqlite(): Promise<Sqlite3Static> {
  loading ??= init().then((sqlite3) => (instance = sqlite3))
  return loading
}

export function getSqlite(): Sqlite3Static {
  if (!instance) throw new Error('sqlite-wasm is not loaded; await loadSqlite() before opening a Database')
  return instance
}
