import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { knowledgeChunkGovernanceTable } from '@data/db/schemas/knowledgeChunkGovernance'

// Adding governance must preserve already-shipped sources without inventing user decisions.
describe('knowledge chunk governance migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0043_charming_stark_industries' })

  it('adds empty governance storage to a populated database without changing existing sources', () => {
    const baseId = '11111111-1111-4111-8111-111111111111'
    const itemId = '0198f3f2-7d1a-7abc-8def-123456789abc'
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: baseId,
        name: 'Existing base',
        orderKey: 'a0',
        status: 'completed',
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: itemId,
        baseId,
        type: 'note',
        status: 'completed',
        data: { source: 'Original source', content: 'Unmodified source text' }
      })
      .run()
    const before = dbh.db.select().from(knowledgeItemTable).all()
    const bases = dbh.db.select().from(knowledgeBaseTable).all()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(before)
    expect(dbh.db.select().from(knowledgeBaseTable).all()).toEqual(bases)
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toEqual([])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
  })
})
