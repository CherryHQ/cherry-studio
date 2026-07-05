// Unit tests for the KNOWLEDGE contributor — pure declaration assertions (no DB).
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { knowledgeBaseTable } from '@main/data/db/schemas/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { collectKnowledgeBaseIds, KNOWLEDGE_CONTRIBUTOR } from '../backupContributor-knowledge'

describe('KNOWLEDGE contributor', () => {
  it('owns knowledge_base + knowledge_item', () => {
    expect(KNOWLEDGE_CONTRIBUTOR.schema.tables).toEqual([table('knowledge_base'), table('knowledge_item')])
  })

  it('declares baseId owning + 3 cross-domain optional references', () => {
    const refs = KNOWLEDGE_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(4)
    // knowledge_item.baseId → knowledge_base: same-domain owning (aggregate membership).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('knowledge_item'),
        column: 'baseId',
        referencedDomain: 'KNOWLEDGE',
        kind: 'owning'
      })
    )
    // knowledge_base.groupId → group (TAGS_GROUPS): optional.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('knowledge_base'),
        column: 'groupId',
        referencedDomain: 'TAGS_GROUPS',
        kind: 'optional'
      })
    )
    // knowledge_base.embeddingModelId/rerankModelId → user_model (PROVIDERS): optional.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('knowledge_base'),
        column: 'embeddingModelId',
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      })
    )
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('knowledge_base'),
        column: 'rerankModelId',
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      })
    )
  })

  it('knowledge_base aggregate has knowledge_item as a baseId include member, non-renamable', () => {
    const aggregate = KNOWLEDGE_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('knowledge_base'))
    expect(aggregate.identityKey).toEqual(['id'])
    expect(aggregate.renamable).toBe(false)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('knowledge_item'), viaColumn: 'baseId', cascade: 'include' })
    ])
  })

  it('declares no fileRefSourcePolicies (knowledge_item is not a FileRefSourceType post-#16532)', () => {
    expect(KNOWLEDGE_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
  })

  it('primary keys are non-ambiguous (knowledge_base uuid-v4; knowledge_item uuid-v7)', () => {
    for (const pk of KNOWLEDGE_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(KNOWLEDGE_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})

// DB-backed tests for collectFileResources — returns knowledge_base ids (each maps to a
// {baseId}/ directory under feature.knowledgebase.data, routed to knowledge/<baseId>/).
describe('KNOWLEDGE collectFileResources (collectKnowledgeBaseIds)', () => {
  const dbh = setupTestDatabase()

  it('returns all knowledge_base ids', async () => {
    // searchMode='bm25' satisfies status_error_check without an embeddingModelId FK
    // (the embeddingModelId NULL + dimensions NULL + bm25 branch).
    await dbh.db.insert(knowledgeBaseTable).values([
      { id: 'kb1', name: 'a', status: 'completed', chunkSize: 100, chunkOverlap: 20, searchMode: 'bm25' },
      { id: 'kb2', name: 'b', status: 'completed', chunkSize: 100, chunkOverlap: 20, searchMode: 'bm25' }
    ])
    const ids = await collectKnowledgeBaseIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set(['kb1', 'kb2']))
  })

  it('returns empty set when no knowledge_base rows exist', async () => {
    const ids = await collectKnowledgeBaseIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set())
  })
})
