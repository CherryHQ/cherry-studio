import { Database as WasmDatabase, type DatabaseOptions, loadSqlite } from '../src'

await loadSqlite()

const isTransient = (filename: string): boolean => filename === '' || filename === ':memory:'

/**
 * Drop-in default export for `better-sqlite3`, aliased in by the main-suite
 * compatibility run. Node's sqlite-wasm keeps files in an in-memory filesystem
 * without directories, so paths are flattened; a reopened path sees its data.
 */
export default class Database extends WasmDatabase {
  constructor(filename = ':memory:', options?: DatabaseOptions) {
    super(isTransient(filename) ? filename : filename.replaceAll('/', '_'), options)
  }
}
