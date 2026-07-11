import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkpointTruncateAssert } from '@data/db/restore/checkpoint'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('checkpointTruncateAssert', () => {
  let tempDir: string
  let dbPath: string
  const connections: Database.Database[] = []

  function open(): Database.Database {
    const db = new Database(dbPath)
    // No busy wait: checkpoint contention must surface immediately as busy>0,
    // not stall the test for the default 5s timeout.
    db.pragma('busy_timeout = 0')
    connections.push(db)
    return db
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-checkpoint-'))
    dbPath = join(tempDir, 'test.db')
  })

  afterEach(() => {
    for (const db of connections.splice(0)) {
      try {
        db.close()
      } catch {
        // already closed by the test
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('truncates a non-empty WAL and passes when no reader interferes', () => {
    const db = open()
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t (v) VALUES (?)').run('row')

    const walPath = `${dbPath}-wal`
    expect(statSync(walPath).size).toBeGreaterThan(0)

    checkpointTruncateAssert(db)

    expect(statSync(walPath).size).toBe(0)
  })

  it('throws when a reader holds an older snapshot (busy > 0)', () => {
    const writer = open()
    writer.pragma('journal_mode = WAL')
    writer.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    writer.prepare('INSERT INTO t (v) VALUES (?)').run('row1')
    checkpointTruncateAssert(writer)

    // A second connection pins a read snapshot, then the writer appends to the
    // WAL past it — TRUNCATE checkpoint can no longer complete.
    const reader = open()
    reader.exec('BEGIN')
    reader.prepare('SELECT COUNT(*) AS c FROM t').get()
    writer.prepare('INSERT INTO t (v) VALUES (?)').run('row2')

    expect(() => checkpointTruncateAssert(writer)).toThrow(/busy=1/)

    reader.exec('COMMIT')
    expect(() => checkpointTruncateAssert(writer)).not.toThrow()
  })
})
