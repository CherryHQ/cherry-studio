import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { KeyedMutex } from '@shared/utils/async'
import type { PosixRelativeFilePath } from '@shared/utils/file'

import {
  cancelMock,
  createBase,
  createCtx,
  createDeleteSubtreeJobHandler,
  createIndexDocumentsJobHandler,
  createJobSnapshot,
  enqueueMock,
  fetchKnowledgeWebPageMock,
  FileProcessingWaitManager,
  knowledgeBaseGetByIdMock,
  listMock,
  loadKnowledgeItemDocumentsMock
} from './jobHandlerTestUtils'

const { knowledgeItemService } = await import('@data/services/KnowledgeItemService')
const { KnowledgeItemService } = await vi.importActual<typeof import('@data/services/KnowledgeItemService')>(
  '@data/services/KnowledgeItemService'
)
const BASE_ID = '11111111-1111-4111-8111-111111111111'

describe('URL crawl jobs with the production item service and migrated SQLite', () => {
  const dbh = setupTestDatabase()
  let service: InstanceType<typeof KnowledgeItemService>
  const locks = new KeyedMutex()
  const links = Array.from({ length: 25 }, (_, index) => `[Page ${index}](/child-${index})`).join(' ')

  beforeEach(async () => {
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' })
    const modelId = createUniqueModelId('openai', 'text-embedding-3-large')
    await dbh.db.insert(userModelTable).values({
      id: modelId,
      providerId: 'openai',
      modelId: 'text-embedding-3-large',
      presetModelId: 'text-embedding-3-large',
      name: 'Embed',
      isEnabled: true,
      isHidden: false,
      orderKey: 'a0'
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      id: BASE_ID,
      orderKey: 'a0',
      name: 'KB',
      dimensions: 3,
      embeddingModelId: modelId,
      status: 'completed',
      error: null,
      chunkSize: 1024,
      chunkOverlap: 200
    })
    service = new KnowledgeItemService()
    Object.assign(knowledgeItemService, {
      getById: service.getById.bind(service),
      getItemsByBaseId: service.getItemsByBaseId.bind(service),
      getSubtreeItems: service.getSubtreeItems.bind(service),
      updateStatus: service.updateStatus.bind(service),
      updateSnapshotRelativePath: service.updateSnapshotRelativePath.bind(service),
      prepareUrlCrawl: service.prepareUrlCrawl.bind(service),
      deleteItemsByIds: service.deleteItemsByIds.bind(service)
    })
    knowledgeBaseGetByIdMock.mockReturnValue(createBase({ id: BASE_ID }))
    loadKnowledgeItemDocumentsMock.mockImplementation(async (item: KnowledgeItemOf<'url'>) => [
      {
        text: item.data.crawl ? links : 'child text with [grandchild](/grandchild)',
        metadata: { source: item.data.url }
      }
    ])
  })

  const addRoot = (crawl = true) =>
    service.createActive(BASE_ID, {
      type: 'url',
      data: { source: 'https://example.com/root', url: 'https://example.com/root', ...(crawl ? { crawl: true } : {}) }
    })

  it('fetches only the root and its first 19 direct children, isolating one provider failure', async () => {
    const root = addRoot()
    const index = createIndexDocumentsJobHandler(locks)
    await index.execute(createCtx({ baseId: BASE_ID, itemId: root.id }))
    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledTimes(19)
    const children = service.getSubtreeItems(BASE_ID, [root.id])
    expect(children).toHaveLength(19)
    fetchKnowledgeWebPageMock.mockRejectedValueOnce(new Error('Child unavailable'))
    for (const child of children) {
      const input = { baseId: BASE_ID, itemId: child.id }
      try {
        await index.execute(createCtx(input))
      } catch (error) {
        await index.onSettled?.({
          jobId: `failed-${child.id}`,
          type: 'knowledge.index-documents',
          status: 'failed',
          scheduleId: null,
          parentId: null,
          input,
          output: undefined,
          error: {
            code: 'TEST_CHILD_FAILURE',
            message: error instanceof Error ? error.message : String(error),
            retryable: false
          },
          attempt: 1,
          metadata: {}
        })
      }
    }
    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledTimes(20)
    expect(enqueueMock).toHaveBeenCalledTimes(19)
    expect(service.getById(root.id)).toMatchObject({
      status: 'completed',
      error: null,
      data: { crawlExpanded: true, crawlProgress: { total: 19, completed: 18, failed: 1, active: 0 } }
    })
    expect(service.getSubtreeItems(BASE_ID, [root.id], { includeRoots: true })).toHaveLength(20)
  })

  it('keeps crawl off to one item despite links in its captured Markdown', async () => {
    const root = addRoot(false)
    loadKnowledgeItemDocumentsMock.mockResolvedValue([{ text: links, metadata: { source: root.data.source } }])
    await createIndexDocumentsJobHandler(locks).execute(createCtx({ baseId: BASE_ID, itemId: root.id }))
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(service.getSubtreeItems(BASE_ID, [root.id], { includeRoots: true })).toHaveLength(1)
    expect(fetchKnowledgeWebPageMock).toHaveBeenCalledTimes(1)
  })

  it('isolates a child enqueue failure and still indexes the root and schedules siblings', async () => {
    const root = addRoot()
    enqueueMock.mockImplementationOnce(() => {
      throw new Error('Queue unavailable')
    })
    await createIndexDocumentsJobHandler(locks).execute(createCtx({ baseId: BASE_ID, itemId: root.id }))
    expect(enqueueMock).toHaveBeenCalledTimes(19)
    expect(service.getById(root.id)).toMatchObject({
      status: 'completed',
      data: { crawlProgress: { failed: 1, active: 18 } }
    })
  })

  it('cancels queued children and removes the actual owned subtree, leaving unrelated work alone', async () => {
    const root = addRoot()
    await createIndexDocumentsJobHandler(locks).execute(createCtx({ baseId: BASE_ID, itemId: root.id }))
    const children = service.getSubtreeItems(BASE_ID, [root.id])
    service.setSubtreeStatus(BASE_ID, [root.id], 'deleting')
    listMock.mockResolvedValue([
      ...children.map((child, index) =>
        createJobSnapshot({
          id: `child-job-${index}`,
          type: 'knowledge.index-documents',
          input: { baseId: BASE_ID, itemId: child.id }
        })
      ),
      createJobSnapshot({
        id: 'unrelated',
        type: 'knowledge.index-documents',
        input: { baseId: BASE_ID, itemId: 'other' }
      })
    ])
    await createDeleteSubtreeJobHandler(locks, new FileProcessingWaitManager()).execute(
      createCtx({ baseId: BASE_ID, rootItemIds: [root.id] }, 'delete-job')
    )
    expect(cancelMock).toHaveBeenCalledTimes(19)
    expect(cancelMock).not.toHaveBeenCalledWith('unrelated', expect.anything())
    expect(service.getSubtreeItems(BASE_ID, [root.id], { includeRoots: true })).toEqual([])
    expect(() => service.getById(root.id)).toThrow()
  })

  it('reindexes a restored captured owner without refetching or rediscovering saved children', async () => {
    const root = service.createActive(BASE_ID, {
      type: 'url',
      data: {
        source: 'https://example.com/root',
        url: 'https://example.com/root',
        crawl: true,
        crawlExpanded: true,
        relativePath: 'restored.md' as PosixRelativeFilePath
      }
    })
    service.createActive(BASE_ID, {
      type: 'url',
      groupId: root.id,
      data: {
        source: 'https://example.com/saved-child',
        url: 'https://example.com/saved-child',
        relativePath: 'saved-child.md' as PosixRelativeFilePath
      }
    })
    await createIndexDocumentsJobHandler(locks).execute(createCtx({ baseId: BASE_ID, itemId: root.id }))
    expect(fetchKnowledgeWebPageMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(service.getSubtreeItems(BASE_ID, [root.id])).toHaveLength(1)
  })

  it('does not expand or enqueue after deletion wins during source capture', async () => {
    const root = addRoot()
    fetchKnowledgeWebPageMock.mockImplementationOnce(async () => {
      service.setSubtreeStatus(BASE_ID, [root.id], 'deleting')
      return { title: 'Root', markdown: links }
    })
    await expect(
      createIndexDocumentsJobHandler(locks).execute(createCtx({ baseId: BASE_ID, itemId: root.id }))
    ).rejects.toThrow()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(service.getSubtreeItems(BASE_ID, [root.id])).toEqual([])
  })
})
