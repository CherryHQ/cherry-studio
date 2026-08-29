import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppFileRefTable, persistentRefAbsenceConditions } from '@data/db/schemas/fileRelations'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

const APP_ID = 'com.example.mygame'

describe('mini_app_file_ref', () => {
  const dbh = setupTestDatabase()

  const insertApp = () =>
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: APP_ID,
        kind: 'app',
        presetMiniAppId: null,
        name: 'App',
        url: `cherry-miniapp://${APP_ID}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()

  const insertEntry = (id: string) => {
    dbh.db
      .insert(fileEntryTable)
      .values({ id, origin: 'internal', name: 'save', ext: 'bin', size: 10, cleanupPolicy: 'delete_when_unreferenced' })
      .run()
    return id
  }

  it('cascades when the owning mini app is deleted', () => {
    insertApp()
    insertEntry('f1')
    dbh.db.insert(miniAppFileRefTable).values({ fileEntryId: 'f1', sourceId: APP_ID, logicalName: 'slot1' }).run()

    dbh.db.delete(miniAppTable).where(eq(miniAppTable.appId, APP_ID)).run()

    expect(dbh.db.select().from(miniAppFileRefTable).all()).toHaveLength(0)
  })

  it('rejects two files sharing one logical name within an app', () => {
    insertApp()
    insertEntry('f1')
    insertEntry('f2')
    dbh.db.insert(miniAppFileRefTable).values({ fileEntryId: 'f1', sourceId: APP_ID, logicalName: 'slot1' }).run()
    expect(() =>
      dbh.db.insert(miniAppFileRefTable).values({ fileEntryId: 'f2', sourceId: APP_ID, logicalName: 'slot1' }).run()
    ).toThrow()
  })

  it('participates in GC discovery via the generated registry', () => {
    const dialect = new SQLiteSyncDialect()
    const sql = persistentRefAbsenceConditions()
      .map((condition) => dialect.sqlToQuery(condition).sql)
      .join(' ')
    expect(sql).toContain('mini_app_file_ref')
  })
})
