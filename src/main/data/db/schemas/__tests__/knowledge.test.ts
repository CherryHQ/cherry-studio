/**
 * DB-level integrity tests for the `knowledge_base` schema.
 *
 * These exercise the SQLite CHECK constraints — runtime guards we rely on
 * beyond the Zod layer. Kept separate from Zod-level shape tests (see
 * `src/shared/__tests__/knowledge-schemas.test.ts`).
 */

import { randomUUID } from 'node:crypto'

import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const TS = 1700000000000

/**
 * Baseline row in `failed` state: `knowledge_base_status_error_check` is
 * satisfied without a `user_model` FK target (embeddingModelId stays null).
 */
type KnowledgeBaseInsert = typeof knowledgeBaseTable.$inferInsert

function baseKb(overrides: Partial<KnowledgeBaseInsert> = {}): KnowledgeBaseInsert {
  return {
    id: randomUUID(),
    name: 'My KB',
    groupId: null,
    dimensions: null,
    embeddingModelId: null,
    status: 'failed',
    error: 'missing_embedding_model',
    rerankModelId: null,
    fileProcessorId: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    threshold: null,
    documentCount: null,
    searchMode: 'hybrid',
    hybridAlpha: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

describe('knowledgeBaseTable — knowledge_base_name_not_blank check', () => {
  const dbh = setupTestDatabase()

  it('accepts a base with a non-blank name', async () => {
    await expect(dbh.db.insert(knowledgeBaseTable).values(baseKb())).resolves.not.toThrow()
  })

  it('rejects an empty name', async () => {
    await expect(dbh.db.insert(knowledgeBaseTable).values(baseKb({ name: '' }))).rejects.toThrow()
  })

  it('rejects an all-whitespace name (the corruption shape that poisons the strict-parsing list query)', async () => {
    await expect(dbh.db.insert(knowledgeBaseTable).values(baseKb({ name: '   ' }))).rejects.toThrow()
  })
})
