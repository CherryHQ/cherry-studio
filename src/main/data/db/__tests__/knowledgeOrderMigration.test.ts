import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'

describe('knowledge ordering migrate-forward', () => {
  const dbh = setupTestDatabase()

  it('preserves custom keys and child rows when migrations run again', () => {
    const service = new KnowledgeBaseService()
    const first = service.create({ name: 'First' })
    const second = service.create({ name: 'Second' })
    service.reorder(first.id, { anchor: { before: second.id } })
    const bases = dbh.db.select().from(knowledgeBaseTable).all()
    dbh.db
      .insert(knowledgeItemTable)
      .values({ baseId: first.id, type: 'note', data: { source: 'Note', content: 'Keep me' }, status: 'completed' })
      .run()
    const items = dbh.db.select().from(knowledgeItemTable).all()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    expect(dbh.db.select().from(knowledgeBaseTable).all()).toEqual(bases)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(items)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
