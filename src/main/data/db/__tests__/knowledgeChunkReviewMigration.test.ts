import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import {
  knowledgeChunkGovernanceHistoryTable,
  knowledgeChunkGovernanceTable
} from '@data/db/schemas/knowledgeChunkGovernance'

// A populated upgrade must not retire an existing exclusion or fabricate review history.
describe('chunk review migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0044_gorgeous_ironclad' })
  it('preserves original evidence and existing decisions, and initializes audit metadata without new rows', () => {
    const baseId = '11111111-1111-4111-8111-111111111111',
      itemId = '22222222-2222-4222-8222-222222222222'
    const id = '33333333-3333-4333-8333-333333333333',
      hash = createHash('sha256').update('Original').digest('hex')
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: baseId, name: 'Existing', orderKey: 'a0', status: 'completed', chunkSize: 1024, chunkOverlap: 0 })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: itemId,
        baseId,
        type: 'note',
        status: 'completed',
        data: { source: 'Original', content: 'Original' }
      })
      .run()
    const state = JSON.stringify({ excluded: true, labels: ['keep'], overrideText: 'Pending correction' })
    dbh.sqlite
      .prepare(`INSERT INTO knowledge_chunk_governance
      (id, base_id, item_id, unit_id, source_content_hash, char_start, char_end, original_text, original_text_hash, state, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 8, 'Original', ?, ?, 4, 100, 101)`)
      .run(id, baseId, itemId, hash, hash, hash, state)
    dbh.sqlite
      .prepare(`INSERT INTO knowledge_chunk_governance_history (id, governance_id, revision, state, created_at)
      VALUES (?, ?, 4, ?, 101)`)
      .run('44444444-4444-4444-8444-444444444444', id, state)
    const sources = dbh.db.select().from(knowledgeItemTable).all()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toMatchObject([
      { id, retired: false, revision: 4, originalText: 'Original', state: JSON.parse(state) }
    ])
    expect(dbh.db.select().from(knowledgeChunkGovernanceHistoryTable).all()).toMatchObject([
      { governanceId: id, revision: 4, operation: 'edit', relatedGovernanceId: null, state: JSON.parse(state) }
    ])
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.db.select().from(knowledgeChunkGovernanceTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(knowledgeChunkGovernanceHistoryTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(sources)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
