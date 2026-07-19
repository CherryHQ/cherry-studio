import Database from 'better-sqlite3'

const l0 = {
  level: 'l0',
  status: 'success',
  data: {
    exists: true,
    fileKind: 'regular',
    sizeBucket: '4_kib_to_1_mib',
    mtimeAgeBucket: 'under_1_hour',
    header: 'valid',
    writeMode: 'wal',
    walSidecars: 'complete'
  }
}
const l1 = { level: 'l1', status: 'failed', code: 'query_failed' }

process.send?.({ type: 'ready', version: 1 })
process.once('message', (input) => {
  if (!input || typeof input !== 'object' || input.mode !== 'full' || typeof input.databaseFile !== 'string') {
    process.exitCode = 1
    process.disconnect?.()
    return
  }

  const database = new Database(input.databaseFile, { readonly: true, fileMustExist: true })
  database.pragma('query_only = ON')
  process.send?.({ type: 'step', step: l0 })
  process.send?.({ type: 'step', step: l1 })

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
