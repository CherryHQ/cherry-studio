import type { Database } from '@cherrystudio/sqlite-wasm-compat'
import type { DbOrTx, DbType } from '@data/db/types'

/**
 * The `DbService` surface the data services use, over the Worker's OPFS
 * connection. Semantics match the desktop service: one synchronous connection,
 * and `withWriteTx` commits all-or-nothing in a `BEGIN IMMEDIATE` transaction.
 */
export class WebDbService {
  readonly isReady = true
  readonly sqlite: Database
  readonly #db: DbType

  constructor(sqlite: Database, db: DbType) {
    this.sqlite = sqlite
    this.#db = db
  }

  getDb(): DbType {
    return this.#db
  }

  withWriteTx<T>(fn: (tx: DbOrTx) => T): T {
    return this.#db.transaction(fn, { behavior: 'immediate' })
  }
}
