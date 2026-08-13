import { messageTable } from '@data/db/schemas/message'
import { setupTestDatabase } from '@test-helpers/db'
import { getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

interface ForeignKeyRow {
  tableName: string
  columnName: string
  onDelete: string
}

interface ColumnRow {
  tableName: string
  columnName: string
}

const MESSAGE_REFERENCE_EXEMPTIONS = new Map([
  ['ai_usage_record.message_id', 'Immutable usage attribution survives message deletion.']
])

describe('message deletion references', () => {
  const dbh = setupTestDatabase()

  it('requires message references to cascade or declare an explicit exemption', () => {
    const messageTableName = getTableName(messageTable)
    const foreignKeys = dbh.sqlite
      .prepare(
        `SELECT m.name AS tableName, fk."from" AS columnName, fk.on_delete AS onDelete
         FROM sqlite_master m
         JOIN pragma_foreign_key_list(m.name) fk
         WHERE m.type = 'table' AND fk."table" = ? AND fk."to" = 'id'`
      )
      .all(messageTableName) as ForeignKeyRow[]
    const conventionalReferences = dbh.sqlite
      .prepare(
        `SELECT m.name AS tableName, column_info.name AS columnName
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) column_info
         WHERE m.type = 'table' AND column_info.name = 'message_id'`
      )
      .all() as ColumnRow[]

    const foreignKeysByReference = new Map(
      foreignKeys.map((foreignKey) => [`${foreignKey.tableName}.${foreignKey.columnName}`, foreignKey])
    )
    const discoveredReferences = new Set([
      ...foreignKeysByReference.keys(),
      ...conventionalReferences.map((reference) => `${reference.tableName}.${reference.columnName}`)
    ])

    expect(discoveredReferences.size).toBeGreaterThan(0)
    for (const reference of discoveredReferences) {
      const foreignKey = foreignKeysByReference.get(reference)
      if (MESSAGE_REFERENCE_EXEMPTIONS.has(reference)) {
        expect(foreignKey, `${reference} must remain an intentional soft reference`).toBeUndefined()
      } else {
        expect(foreignKey?.onDelete.toUpperCase(), `${reference} must cascade on message deletion`).toBe('CASCADE')
      }
    }
    for (const reference of MESSAGE_REFERENCE_EXEMPTIONS.keys()) {
      expect(discoveredReferences.has(reference), `${reference} exemption is stale`).toBe(true)
    }
  })
})
