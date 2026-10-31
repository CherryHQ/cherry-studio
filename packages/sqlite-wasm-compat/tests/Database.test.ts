import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { Database, loadSqlite, SqliteError } from '../src'

const parentTable = sqliteTable('parent', { id: integer().primaryKey(), name: text().notNull().unique() })
const childTable = sqliteTable('child', {
  id: integer().primaryKey(),
  parentId: integer('parent_id').references(() => parentTable.id, { onDelete: 'cascade' })
})

const SCHEMA = `
  CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
  CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE);
`

let db: Database

beforeAll(async () => {
  await loadSqlite()
})

function open(): Database {
  db = new Database()
  db.exec(SCHEMA)
  return db
}

afterEach(() => {
  db?.close()
})

const count = (table: string): number => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number

function captureError(fn: () => unknown): SqliteError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(SqliteError)
    return error as SqliteError
  }
  throw new Error('expected the call to throw')
}

describe('foreign keys', () => {
  it('are enforced on open, so ON DELETE CASCADE removes dependent rows', () => {
    open()
    db.prepare('INSERT INTO parent (id, name) VALUES (1, ?)').run('a')
    db.prepare('INSERT INTO child (id, parent_id) VALUES (10, 1)').run()

    db.prepare('DELETE FROM parent WHERE id = 1').run()

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(count('child')).toBe(0)
  })

  it('reject a dangling reference with SQLITE_CONSTRAINT_FOREIGNKEY', () => {
    open()
    const error = captureError(() => db.prepare('INSERT INTO child (id, parent_id) VALUES (1, 99)').run())
    expect(error.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
  })
})

describe('errors', () => {
  it('carry the extended result code and the bare SQLite message', () => {
    open()
    db.prepare('INSERT INTO parent (id, name) VALUES (1, ?)').run('a')

    const unique = captureError(() => db.prepare('INSERT INTO parent (id, name) VALUES (2, ?)').run('a'))
    expect(unique.code).toBe('SQLITE_CONSTRAINT_UNIQUE')
    expect(unique.message).toBe('UNIQUE constraint failed: parent.name')

    const notNull = captureError(() => db.prepare('INSERT INTO parent (id, name) VALUES (3, NULL)').run())
    expect(notNull.code).toBe('SQLITE_CONSTRAINT_NOTNULL')
    expect(notNull.message).toBe('NOT NULL constraint failed: parent.name')
  })

  it('are raised at prepare time for invalid SQL', () => {
    open()
    const error = captureError(() => db.prepare('SELEC 1'))
    expect(error.code).toBe('SQLITE_ERROR')
    expect(error.message).toContain('syntax error')
  })

  it('leave the statement reusable after a failed run', () => {
    open()
    const insert = db.prepare('INSERT INTO parent (id, name) VALUES (?, ?)')
    insert.run(1, 'a')
    captureError(() => insert.run(2, 'a'))
    insert.run(3, 'b')
    expect(count('parent')).toBe(2)
  })
})

describe('transactions', () => {
  it('commit on return and roll back every write on throw', () => {
    open()
    const insertTwo = db.transaction((fail: boolean) => {
      db.prepare('INSERT INTO parent (id, name) VALUES (1, ?)').run('a')
      db.prepare('INSERT INTO parent (id, name) VALUES (2, ?)').run('b')
      if (fail) throw new Error('boom')
    })

    expect(() => insertTwo(true)).toThrow('boom')
    expect(count('parent')).toBe(0)
    expect(db.inTransaction).toBe(false)

    insertTwo(false)
    expect(count('parent')).toBe(2)
  })

  it('reject a promise-returning callback and roll back its synchronous writes', () => {
    open()
    const asyncTx = db.transaction(async () => {
      db.prepare('INSERT INTO parent (id, name) VALUES (1, ?)').run('a')
    })

    expect(() => asyncTx.immediate()).toThrow(TypeError)
    expect(count('parent')).toBe(0)
    expect(db.inTransaction).toBe(false)
  })

  it('roll back only the inner writes when a nested transaction throws', () => {
    open()
    const inner = db.transaction(() => {
      db.prepare('INSERT INTO parent (id, name) VALUES (2, ?)').run('inner')
      throw new Error('inner failed')
    })
    const outer = db.transaction(() => {
      db.prepare('INSERT INTO parent (id, name) VALUES (1, ?)').run('outer')
      expect(() => inner()).toThrow('inner failed')
      expect(db.inTransaction).toBe(true)
    })

    outer.immediate()

    expect(db.prepare('SELECT name FROM parent').pluck().all()).toEqual(['outer'])
  })

  it('take the write lock up front for immediate transactions', () => {
    open()
    let lockedDuringCallback = false
    db.transaction(() => {
      lockedDuringCallback = db.inTransaction
    }).immediate()
    expect(lockedDuringCallback).toBe(true)
  })
})

describe('statements', () => {
  it('report changes and the last inserted rowid', () => {
    open()
    expect(db.prepare('INSERT INTO parent (name) VALUES (?)').run('a')).toEqual({ changes: 1, lastInsertRowid: 1 })
    db.prepare('INSERT INTO parent (name) VALUES (?)').run('b')
    expect(db.prepare('UPDATE parent SET name = name || ?').run('!').changes).toBe(2)
  })

  it('return objects, raw arrays or plucked values', () => {
    open()
    db.prepare('INSERT INTO parent (id, name) VALUES (?, ?), (?, ?)').run(1, 'a', [2, 'b'])
    const select = db.prepare('SELECT id, name FROM parent ORDER BY id')

    expect(select.all()).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' }
    ])
    expect(select.raw().get()).toEqual([1, 'a'])
    expect(select.pluck().all()).toEqual([1, 2])
    expect(select.reader).toBe(true)
    expect(db.prepare('DELETE FROM parent').reader).toBe(false)
  })

  it('bind named parameters from an object without their prefix', () => {
    open()
    db.prepare('INSERT INTO parent (id, name) VALUES (@id, :name)').run({ id: 7, name: 'named' })
    expect(db.prepare('SELECT name FROM parent WHERE id = $id').pluck().get({ id: 7 })).toBe('named')
  })

  it('round-trip blobs and keep working after the statement cache evicts them', () => {
    db = new Database(':memory:', { statementCacheSize: 2 })
    db.exec('CREATE TABLE blob (id INTEGER PRIMARY KEY, data BLOB)')
    const insert = db.prepare('INSERT INTO blob (id, data) VALUES (?, ?)')
    insert.run(1, new Uint8Array([1, 2, 3]))

    for (let i = 0; i < 5; i++) db.prepare(`SELECT ${i}`).get()

    insert.run(2, new Uint8Array([4]))
    expect(db.prepare('SELECT data FROM blob WHERE id = 1').pluck().get()).toEqual(new Uint8Array([1, 2, 3]))
    expect(count('blob')).toBe(2)
  })
})

describe('custom functions', () => {
  it('are callable from SQL', () => {
    open()
    db.function('shout', { deterministic: true }, (value: string) => `${value.toUpperCase()}!`)
    expect(db.prepare('SELECT shout(?)').pluck().get('hi')).toBe('HI!')
  })
})

describe('drizzle-orm/better-sqlite3', () => {
  it('runs queries and transactions on the facade', () => {
    open()
    const orm = drizzle({ client: db as never, casing: 'snake_case' })

    orm.insert(parentTable).values({ id: 1, name: 'a' }).run()
    orm.insert(childTable).values({ id: 10, parentId: 1 }).run()
    expect(() =>
      orm.transaction(
        (tx) => {
          tx.insert(parentTable).values({ id: 2, name: 'b' }).run()
          tx.transaction((nested) => nested.insert(parentTable).values({ id: 3, name: 'c' }).run())
          tx.insert(parentTable).values({ id: 4, name: 'a' }).run()
        },
        { behavior: 'immediate' }
      )
    ).toThrow()

    orm.delete(parentTable).where(eq(parentTable.id, 1)).run()

    expect(orm.select().from(parentTable).all()).toEqual([])
    expect(orm.all(sql`SELECT * FROM child`)).toEqual([])
    expect(orm.select().from(parentTable).get()).toBeUndefined()
  })
})
