import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

import { KnowledgeQueryService } from '../KnowledgeQueryService'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '0198f3f2-7d21-7abc-8def-123456789abc'

describe('external snapshot visibility', () => {
  const dbh = setupTestDatabase()
  it.each(['deleting', 'processing', 'failed'] as const)(
    'rejects a previously valid preview after the item becomes %s',
    (status) => {
      dbh.db
        .insert(knowledgeBaseTable)
        .values({
          id: BASE_ID,
          name: 'Preview',
          orderKey: 'a0',
          status: 'completed',
          chunkSize: 1024,
          chunkOverlap: 200
        })
        .run()
      dbh.db
        .insert(knowledgeItemTable)
        .values({
          id: ITEM_ID,
          baseId: BASE_ID,
          type: 'external',
          status: 'completed',
          data: {
            source: 'Feishu',
            title: 'Document',
            relativePath: KnowledgeRelativePathSchema.parse('external/document.md')
          }
        })
        .run()
      const query = new KnowledgeQueryService()
      expect(query.getFilePath(ITEM_ID)).toMatch(/external\/document\.md$/)
      dbh.db
        .update(knowledgeItemTable)
        .set({ status, error: status === 'failed' ? 'indexing failed' : null })
        .where(eq(knowledgeItemTable.id, ITEM_ID))
        .run()
      expect(() => query.getFilePath(ITEM_ID)).toThrow(expect.objectContaining({ code: 'INVALID_OPERATION' }))
    }
  )
})
