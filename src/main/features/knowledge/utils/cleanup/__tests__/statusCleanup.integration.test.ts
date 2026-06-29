import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import type { LoggerService } from '@main/core/logger/LoggerService'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_SEARCH_MODE
} from '@shared/data/types/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

const { markUnscheduledKnowledgeItemsFailed } = await import('../statusCleanup')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const ROOT_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const CHILD_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'

describe('markUnscheduledKnowledgeItemsFailed integration', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    const [providerOrderKey, embeddingModelOrderKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({
      providerId: 'provider',
      name: 'Provider',
      orderKey: providerOrderKey
    })
    await dbh.db.insert(userModelTable).values({
      id: 'provider::embed',
      providerId: 'provider',
      modelId: 'embed',
      presetModelId: 'embed',
      name: 'embed',
      isEnabled: true,
      isHidden: false,
      orderKey: embeddingModelOrderKey
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      id: BASE_ID,
      name: 'KB',
      groupId: null,
      dimensions: 3,
      embeddingModelId: 'provider::embed',
      status: 'completed',
      error: null,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      threshold: null,
      documentCount: null,
      searchMode: DEFAULT_KNOWLEDGE_SEARCH_MODE
    })
    await dbh.db.insert(knowledgeItemTable).values([
      {
        id: ROOT_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'directory',
        data: { source: 'root' },
        status: 'processing',
        error: null
      },
      {
        id: CHILD_ID,
        baseId: BASE_ID,
        groupId: ROOT_ID,
        type: 'note',
        data: { source: 'child', content: 'hello' },
        status: 'deleting',
        error: null
      }
    ])
  })

  it('falls back to subtree status without reviving deleting descendants', async () => {
    const updateStatusSpy = vi.spyOn(knowledgeItemService, 'updateStatus')
    updateStatusSpy.mockRejectedValueOnce(new Error('status busy'))

    try {
      await markUnscheduledKnowledgeItemsFailed({
        baseId: BASE_ID,
        items: [
          {
            id: ROOT_ID,
            baseId: BASE_ID,
            groupId: null,
            type: 'directory',
            data: { source: 'root' },
            status: 'processing',
            error: null,
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z'
          }
        ],
        completedItemIds: new Set(),
        errorMessage: 'enqueue failed',
        failedStatusError: 'Failed to schedule knowledge child item job: enqueue failed',
        logger: {
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn()
        } as unknown as LoggerService,
        logMessage: 'Failed to mark unscheduled item',
        logContextKey: 'scheduleError'
      })
    } finally {
      updateStatusSpy.mockRestore()
    }

    const rows = await dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.baseId, BASE_ID))
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ROOT_ID,
          status: 'failed',
          error: 'Failed to schedule knowledge child item job: enqueue failed'
        }),
        expect.objectContaining({
          id: CHILD_ID,
          status: 'deleting',
          error: null
        })
      ])
    )
  })
})
