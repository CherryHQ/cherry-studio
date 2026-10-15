import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobContext } from '@main/core/job/types'
import type * as FsUtils from '@main/utils/file'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

import type { KnowledgeItemScheduler } from '../../ingestion/KnowledgeIngestionService'
import type * as PathStorage from '../../pathStorage'

const {
  deleteKnowledgeItemFilesBestEffortMock,
  deleteMaterialsMock,
  fetchKnowledgeWebPageMock,
  listMock,
  prepareKnowledgeItemMock,
  probeKnowledgeFileMock,
  probeKnowledgeSourcePathMock,
  removeDirMock
} = vi.hoisted(() => ({
  deleteKnowledgeItemFilesBestEffortMock: vi.fn(),
  deleteMaterialsMock: vi.fn(),
  fetchKnowledgeWebPageMock: vi.fn(),
  listMock: vi.fn(),
  prepareKnowledgeItemMock: vi.fn(),
  probeKnowledgeFileMock: vi.fn(),
  probeKnowledgeSourcePathMock: vi.fn(),
  removeDirMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      list: listMock
    },
    KnowledgeVectorStoreService: {
      getIndexStoreIfExists: () => ({ deleteMaterials: deleteMaterialsMock })
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('../../pathStorage', async () => ({
  ...(await vi.importActual<typeof PathStorage>('../../pathStorage')),
  deleteKnowledgeItemFilesBestEffort: deleteKnowledgeItemFilesBestEffortMock,
  probeKnowledgeFile: probeKnowledgeFileMock,
  probeKnowledgeSourcePath: probeKnowledgeSourcePathMock
}))

vi.mock('../prepareItem', () => ({ prepareKnowledgeItem: prepareKnowledgeItemMock }))

vi.mock('../../pipeline/sources/url', () => ({ fetchKnowledgeWebPage: fetchKnowledgeWebPageMock }))

vi.mock('@main/utils/file', async (importOriginal) => ({
  ...(await importOriginal<typeof FsUtils>()),
  removeDir: removeDirMock
}))

const { createPrepareRootJobHandler } = await import('../prepareRootJobHandler')
const { createReindexSubtreeJobHandler } = await import('../reindexSubtreeJobHandler')
const { createDeleteSubtreeJobHandler } = await import('../deleteSubtreeJobHandler')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const DIRECTORY_ID = '0198f3f2-7d20-7abc-8def-123456789abc'
const EXTERNAL_ITEM_ID = '0198f3f2-7d21-7abc-8def-123456789abc'
const CONNECTION_ID = '0198f3f2-7d22-7abc-8def-123456789abc'
const SOURCE_ID = '0198f3f2-7d23-7abc-8def-123456789abc'
const DOCUMENT_ID = '0198f3f2-7d24-7abc-8def-123456789abc'
const URL_ITEM_ID = '0198f3f2-7d25-7abc-8def-123456789abc'
const ARTIFACT_SENTINEL = new Error('artifact cleanup started')

function createCtx<TInput>(input: TInput): JobContext<TInput> {
  return {
    jobId: 'job-1',
    input,
    attempt: 1,
    parentId: null,
    signal: new AbortController().signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as JobContext['logger']
  }
}

describe('owned subtree job handler admission', () => {
  const dbh = setupTestDatabase()
  const scheduler: KnowledgeItemScheduler = {
    scheduleFileProcessingCheck: vi.fn(),
    scheduleIndexing: vi.fn(),
    scheduleItem: vi.fn()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    deleteMaterialsMock.mockRejectedValue(ARTIFACT_SENTINEL)
    deleteKnowledgeItemFilesBestEffortMock.mockRejectedValue(ARTIFACT_SENTINEL)
    prepareKnowledgeItemMock.mockRejectedValue(new Error('scan started'))
    fetchKnowledgeWebPageMock.mockResolvedValue({ title: 'Updated', markdown: '# Updated' })
    probeKnowledgeFileMock.mockResolvedValue('readable')
    probeKnowledgeSourcePathMock.mockResolvedValue('readable')
    listMock.mockResolvedValue([])
    vi.mocked(scheduler.scheduleItem).mockResolvedValue(undefined)
    vi.mocked(scheduler.scheduleIndexing).mockResolvedValue(undefined)
    vi.mocked(scheduler.scheduleFileProcessingCheck).mockResolvedValue(undefined)

    await dbh.db.insert(knowledgeBaseTable).values({
      id: BASE_ID,
      name: 'External KB',
      groupId: null,
      dimensions: null,
      embeddingModelId: null,
      status: 'completed',
      error: null,
      rerankModelId: null,
      fileProcessorId: null,
      chunkSize: 1024,
      chunkOverlap: 200,
      documentCount: null
    })
    await dbh.db.insert(externalKnowledgeConnectionTable).values({
      id: CONNECTION_ID,
      provider: 'feishu',
      appId: 'cli_owned_subtree',
      appCredentialSource: 'personal-agent',
      authorizationStatus: 'pending-authorization',
      credentialReference: 'cred_owned_subtree'
    })
    await dbh.db.insert(externalKnowledgeSourceTable).values({
      id: SOURCE_ID,
      baseId: BASE_ID,
      connectionId: CONNECTION_ID,
      provider: 'feishu',
      tenantId: 'tenant-owned-subtree',
      spaceId: 'space-owned-subtree',
      scope: { kind: 'space' },
      name: 'Owned subtree',
      state: 'active',
      revision: 0
    })
  })

  async function seedSubtree(rootStatus: 'preparing' | 'completed' | 'deleting', owned = true) {
    await dbh.db.insert(knowledgeItemTable).values([
      {
        id: DIRECTORY_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'directory',
        data: { source: '/external', relativePath: KnowledgeRelativePathSchema.parse('external') },
        status: rootStatus,
        error: null
      },
      {
        id: EXTERNAL_ITEM_ID,
        baseId: BASE_ID,
        groupId: DIRECTORY_ID,
        type: 'external',
        data: {
          source: 'feishu://document/doc-1',
          title: 'External doc',
          relativePath: KnowledgeRelativePathSchema.parse('external/doc-1.md')
        },
        status: rootStatus === 'deleting' ? 'deleting' : 'completed',
        error: null
      }
    ])
    if (owned) await seedActiveOwner()
  }

  async function seedActiveOwner() {
    await dbh.db.insert(externalKnowledgeDocumentTable).values({
      id: DOCUMENT_ID,
      sourceId: SOURCE_ID,
      remoteObjectId: 'doc-1',
      canonicalNodeId: 'node-1',
      parentNodeId: null,
      relativeBreadcrumb: ['External doc'],
      title: 'External doc',
      originalUrl: 'https://example.feishu.cn/wiki/node-1',
      remoteRevision: '1',
      contentHash: 'hash-1',
      lastSeenAt: 1,
      availability: 'active',
      knowledgeItemId: EXTERNAL_ITEM_ID,
      currentWarning: null
    })
  }

  async function loadStatuses() {
    const rows = await dbh.db
      .select({ id: knowledgeItemTable.id, status: knowledgeItemTable.status })
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, BASE_ID))
    return new Map(rows.map((row) => [row.id, row.status]))
  }

  it('prepare-root rejects an active-owned stale descendant before purge or scan', async () => {
    await seedSubtree('preparing')
    const handler = createPrepareRootJobHandler(new KeyedMutex(), scheduler)

    await expect(handler.execute(createCtx({ baseId: BASE_ID, itemId: DIRECTORY_ID }))).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })

    const statuses = await loadStatuses()
    expect(statuses.get(DIRECTORY_ID)).toBe('preparing')
    expect(statuses.get(EXTERNAL_ITEM_ID)).toBe('completed')
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteKnowledgeItemFilesBestEffortMock).not.toHaveBeenCalled()
    expect(prepareKnowledgeItemMock).not.toHaveBeenCalled()
    expect(removeDirMock).not.toHaveBeenCalled()
  })

  it('reindex rejects a container with an active-owned descendant before reset or artifact changes', async () => {
    await seedSubtree('completed', false)
    const lock = new KeyedMutex()
    const runExclusive = lock.runExclusive.bind(lock)
    vi.spyOn(lock, 'runExclusive').mockImplementation(async (key, task) =>
      runExclusive(key, async () => {
        await seedActiveOwner()
        return await task()
      })
    )
    const handler = createReindexSubtreeJobHandler(lock, scheduler)

    await expect(handler.execute(createCtx({ baseId: BASE_ID, rootItemIds: [DIRECTORY_ID] }))).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })

    const statuses = await loadStatuses()
    expect(statuses.get(DIRECTORY_ID)).toBe('completed')
    expect(statuses.get(EXTERNAL_ITEM_ID)).toBe('completed')
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteKnowledgeItemFilesBestEffortMock).not.toHaveBeenCalled()
    expect(scheduler.scheduleItem).not.toHaveBeenCalled()
  })

  it('reindex still allows an ownerless static external leaf', async () => {
    await dbh.db.insert(knowledgeItemTable).values({
      id: EXTERNAL_ITEM_ID,
      baseId: BASE_ID,
      groupId: null,
      type: 'external',
      data: {
        source: 'feishu://document/static-1',
        title: 'Static external doc',
        relativePath: KnowledgeRelativePathSchema.parse('external/static-1.md')
      },
      status: 'completed',
      error: null
    })
    deleteMaterialsMock.mockResolvedValue(undefined)
    const handler = createReindexSubtreeJobHandler(new KeyedMutex(), scheduler)

    await expect(
      handler.execute(createCtx({ baseId: BASE_ID, rootItemIds: [EXTERNAL_ITEM_ID] }))
    ).resolves.toBeUndefined()

    const statuses = await loadStatuses()
    expect(statuses.get(EXTERNAL_ITEM_ID)).toBe('processing')
    expect(deleteMaterialsMock).toHaveBeenCalledWith([EXTERNAL_ITEM_ID])
    expect(scheduler.scheduleItem).toHaveBeenCalledWith(BASE_ID, EXTERNAL_ITEM_ID, 'job-1', {
      forceFileReprocess: true
    })
  })

  it('reindex allows an active-owned external leaf to rebuild from its pinned snapshot', async () => {
    await dbh.db.insert(knowledgeItemTable).values({
      id: EXTERNAL_ITEM_ID,
      baseId: BASE_ID,
      groupId: null,
      type: 'external',
      data: {
        source: 'feishu://document/doc-1',
        title: 'External doc',
        relativePath: KnowledgeRelativePathSchema.parse('external/doc-1.md')
      },
      status: 'completed',
      error: null
    })
    await seedActiveOwner()
    deleteMaterialsMock.mockResolvedValue(undefined)
    const handler = createReindexSubtreeJobHandler(new KeyedMutex(), scheduler)

    await expect(
      handler.execute(createCtx({ baseId: BASE_ID, rootItemIds: [EXTERNAL_ITEM_ID] }))
    ).resolves.toBeUndefined()

    const statuses = await loadStatuses()
    expect(statuses.get(EXTERNAL_ITEM_ID)).toBe('processing')
    expect(deleteMaterialsMock).toHaveBeenCalledWith([EXTERNAL_ITEM_ID])
    expect(deleteKnowledgeItemFilesBestEffortMock).not.toHaveBeenCalled()
    expect(scheduler.scheduleItem).toHaveBeenCalledWith(BASE_ID, EXTERNAL_ITEM_ID, 'job-1', {
      forceFileReprocess: true
    })
  })

  it('reindex ownership wins over a sibling producer failure without mutating either root', async () => {
    await seedSubtree('completed', false)
    await dbh.db.insert(knowledgeItemTable).values({
      id: URL_ITEM_ID,
      baseId: BASE_ID,
      groupId: null,
      type: 'url',
      data: {
        source: 'https://example.com',
        url: 'https://example.com',
        relativePath: KnowledgeRelativePathSchema.parse('example.md')
      },
      status: 'completed',
      error: null
    })
    fetchKnowledgeWebPageMock.mockImplementationOnce(async () => {
      await seedActiveOwner()
      throw new Error('404 Not Found')
    })
    const handler = createReindexSubtreeJobHandler(new KeyedMutex(), scheduler)

    await expect(
      handler.execute(createCtx({ baseId: BASE_ID, rootItemIds: [DIRECTORY_ID, URL_ITEM_ID] }))
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' })

    const statuses = await loadStatuses()
    expect(statuses.get(DIRECTORY_ID)).toBe('completed')
    expect(statuses.get(EXTERNAL_ITEM_ID)).toBe('completed')
    expect(statuses.get(URL_ITEM_ID)).toBe('completed')
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteKnowledgeItemFilesBestEffortMock).not.toHaveBeenCalled()
    expect(scheduler.scheduleItem).not.toHaveBeenCalled()
  })

  it('delete recovery rejects an active-owned subtree before artifact cleanup', async () => {
    await seedSubtree('deleting')
    const handler = createDeleteSubtreeJobHandler(new KeyedMutex())

    await expect(handler.execute(createCtx({ baseId: BASE_ID, rootItemIds: [DIRECTORY_ID] }))).rejects.toMatchObject({
      code: 'INVALID_OPERATION'
    })

    const statuses = await loadStatuses()
    expect(statuses.get(DIRECTORY_ID)).toBe('deleting')
    expect(statuses.get(EXTERNAL_ITEM_ID)).toBe('deleting')
    expect(deleteMaterialsMock).not.toHaveBeenCalled()
    expect(deleteKnowledgeItemFilesBestEffortMock).not.toHaveBeenCalled()
  })
})
