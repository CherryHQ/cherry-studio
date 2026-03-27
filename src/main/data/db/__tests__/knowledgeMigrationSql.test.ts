import { readdir, readFile } from 'node:fs/promises'

import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'

let closeClient: (() => void) | undefined

describe('knowledge migration SQL', () => {
  afterEach(() => {
    closeClient?.()
    closeClient = undefined
  })

  it('creates knowledge_item with expected indexes and foreign keys', async () => {
    const migrationDir = `${process.cwd()}/migrations/sqlite-drizzle`
    const migrationFile = (await readdir(migrationDir)).find((name) => /^0006_.*\.sql$/.test(name))
    if (!migrationFile) {
      throw new Error('Expected a generated 0006 knowledge migration file')
    }

    const sqlText = await readFile(`${migrationDir}/${migrationFile}`, 'utf8')
    const statements = sqlText
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)

    const client = createClient({ url: 'file::memory:' })
    closeClient = () => client.close()

    for (const statement of statements) {
      await client.execute(statement)
    }

    const indexes = await client.execute(`PRAGMA index_list('knowledge_item')`)
    const indexNames = indexes.rows.map((row) => String(row.name))
    expect(indexNames).toContain('knowledge_item_base_parent_created_idx')
    expect(indexNames).toContain('knowledge_item_base_parent_type_created_idx')

    const foreignKeys = await client.execute(`PRAGMA foreign_key_list('knowledge_item')`)
    expect(foreignKeys.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'knowledge_base',
          from: 'base_id',
          to: 'id',
          on_delete: 'CASCADE'
        }),
        expect.objectContaining({
          table: 'knowledge_item',
          from: 'parent_id',
          to: 'id',
          on_delete: 'CASCADE'
        })
      ])
    )
  })
})
