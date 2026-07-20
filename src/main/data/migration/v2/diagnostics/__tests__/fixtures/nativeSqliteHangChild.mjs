import Database from 'better-sqlite3'

process.once('message', (input) => {
  if (!input || typeof input !== 'object' || typeof input.databaseFile !== 'string') {
    process.exitCode = 1
    process.disconnect?.()
    return
  }

  const database = new Database(input.databaseFile, { readonly: true, fileMustExist: true })
  database.pragma('query_only = ON')

  // Intentionally much longer than the host timeout. This SQL exists only in
  // the tracked test fixture; the production child protocol has no SQL field.
  database
    .prepare(
      'WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 1000000000) SELECT sum(value) FROM counter'
    )
    .get()
  database.close()
  process.disconnect?.()
})
