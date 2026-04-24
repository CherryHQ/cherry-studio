import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  runtimeAddItemsMock,
  expandDirectoryOwnerToTreeMock,
  expandSitemapOwnerToCreateItemsMock,
  knowledgeItemCreateManyInBaseMock,
  knowledgeItemRefreshContainerStatusesMock,
  knowledgeItemUpdateMock,
  knowledgeItemUpdateStatusesMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  runtimeAddItemsMock: vi.fn(),
  expandDirectoryOwnerToTreeMock: vi.fn(),
  expandSitemapOwnerToCreateItemsMock: vi.fn(),
  knowledgeItemCreateManyInBaseMock: vi.fn(),
  knowledgeItemRefreshContainerStatusesMock: vi.fn(),
  knowledgeItemUpdateMock: vi.fn(),
  knowledgeItemUpdateStatusesMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    createManyInBase: knowledgeItemCreateManyInBaseMock,
    refreshContainerStatuses: knowledgeItemRefreshContainerStatusesMock,
    update: knowledgeItemUpdateMock,
    updateStatuses: knowledgeItemUpdateStatusesMock
  }
}))

vi.mock('../utils/directory', () => ({
  expandDirectoryOwnerToTree: expandDirectoryOwnerToTreeMock
}))

vi.mock('../utils/sitemap', () => ({
  expandSitemapOwnerToCreateItems: expandSitemapOwnerToCreateItemsMock
}))

const { processKnowledgeSources } = await import('../processKnowledgeSources')

function createBase() {
  return {
    id: 'kb-1',
    name: 'KB',
    emoji: '📁',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    chunkSize: 1024,
    chunkOverlap: 200,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDirectoryItem(id = 'dir-1', groupId: string | null = null) {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'directory' as const,
    data: { name: id, path: `/docs/${id}` },
    status: 'pending' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createSitemapItem() {
  return {
    id: 'sitemap-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'sitemap' as const,
    data: { url: 'https://example.com/sitemap.xml', name: 'Example Sitemap' },
    status: 'pending' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createNoteItem(id = 'note-1') {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note' as const,
    data: { content: `hello ${id}` },
    status: 'pending' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createFileItem(id = 'file-1', groupId: string | null = null) {
  return {
    id,
    baseId: 'kb-1',
    groupId,
    type: 'file' as const,
    data: {
      file: {
        id: `${id}-meta`,
        name: `${id}.md`,
        origin_name: `${id}.md`,
        path: `/docs/${id}.md`,
        created_at: '2026-04-08T00:00:00.000Z',
        size: 10,
        ext: '.md',
        type: 'text',
        count: 1
      }
    },
    status: 'pending' as const,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('processKnowledgeSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'KnowledgeRuntimeService') {
        return {
          addItems: runtimeAddItemsMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })

    expandDirectoryOwnerToTreeMock.mockResolvedValue([])
    expandSitemapOwnerToCreateItemsMock.mockResolvedValue([])
    knowledgeItemCreateManyInBaseMock.mockResolvedValue({ items: [] })
    knowledgeItemRefreshContainerStatusesMock.mockResolvedValue(undefined)
    knowledgeItemUpdateMock.mockImplementation(async (id: string, dto: unknown) => ({ id, ...(dto as object) }))
    knowledgeItemUpdateStatusesMock.mockResolvedValue([])
    runtimeAddItemsMock.mockResolvedValue(undefined)
  })

  it('enqueues leaf items directly', async () => {
    const base = createBase()
    const note = createNoteItem()

    await processKnowledgeSources(base, [note])

    expect(runtimeAddItemsMock).toHaveBeenCalledWith(base, [note])
    expect(knowledgeItemCreateManyInBaseMock).not.toHaveBeenCalled()
  })

  it('expands directory trees and enqueues only file leaves', async () => {
    const base = createBase()
    const root = createDirectoryItem('dir-root')
    const childDir = createDirectoryItem('dir-child', root.id)
    const childFile = createFileItem('file-child', childDir.id)
    knowledgeItemCreateManyInBaseMock
      .mockResolvedValueOnce({ items: [childDir] })
      .mockResolvedValueOnce({ items: [childFile] })
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([
      {
        type: 'directory',
        data: childDir.data,
        children: [
          {
            type: 'file',
            data: childFile.data
          }
        ]
      }
    ])

    await processKnowledgeSources(base, [root])

    expect(expandDirectoryOwnerToTreeMock).toHaveBeenCalledWith(root)
    expect(knowledgeItemCreateManyInBaseMock).toHaveBeenNthCalledWith(
      1,
      base.id,
      [{ groupId: root.id, type: 'directory', data: childDir.data, status: 'pending' }],
      { status: 'pending' }
    )
    expect(knowledgeItemCreateManyInBaseMock).toHaveBeenNthCalledWith(
      2,
      base.id,
      [{ groupId: childDir.id, type: 'file', data: childFile.data, status: 'pending' }],
      { status: 'pending' }
    )
    expect(runtimeAddItemsMock).toHaveBeenCalledWith(base, [childFile])
    expect(knowledgeItemRefreshContainerStatusesMock).toHaveBeenCalledWith([childFile.groupId])
  })

  it('marks empty expanded containers completed and skips runtime enqueue', async () => {
    const root = createDirectoryItem('dir-root')
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([])

    await processKnowledgeSources(createBase(), [root])

    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(root.id, { status: 'completed', error: null })
    expect(runtimeAddItemsMock).not.toHaveBeenCalled()
  })

  it('expands sitemap items into url children before enqueueing leaf items', async () => {
    const base = createBase()
    const sitemap = createSitemapItem()
    const urlChild = {
      id: 'url-child',
      baseId: base.id,
      groupId: sitemap.id,
      type: 'url' as const,
      data: { url: 'https://example.com/page-1', name: 'https://example.com/page-1' },
      status: 'pending' as const,
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }
    expandSitemapOwnerToCreateItemsMock.mockResolvedValueOnce([{ type: 'url', data: urlChild.data }])
    knowledgeItemCreateManyInBaseMock.mockResolvedValueOnce({ items: [urlChild] })

    await processKnowledgeSources(base, [sitemap])

    expect(knowledgeItemCreateManyInBaseMock).toHaveBeenCalledWith(
      base.id,
      [{ type: 'url', data: urlChild.data, groupId: sitemap.id, status: 'pending' }],
      { status: 'pending' }
    )
    expect(runtimeAddItemsMock).toHaveBeenCalledWith(base, [urlChild])
    expect(knowledgeItemRefreshContainerStatusesMock).toHaveBeenCalledWith([sitemap.id])
  })

  it('marks runtime enqueue failures on leaves', async () => {
    const base = createBase()
    const root = createDirectoryItem('dir-root')
    const childFile = createFileItem('file-child', root.id)
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([{ type: 'file', data: childFile.data }])
    knowledgeItemCreateManyInBaseMock.mockResolvedValueOnce({ items: [childFile] })
    runtimeAddItemsMock.mockRejectedValueOnce(new Error('enqueue failed'))

    await expect(processKnowledgeSources(base, [root])).rejects.toThrow('enqueue failed')

    expect(knowledgeItemUpdateStatusesMock).toHaveBeenCalledWith([childFile.id], {
      status: 'failed',
      error: 'enqueue failed'
    })
  })

  it('marks only failed expanded containers and still enqueues other leaves', async () => {
    const base = createBase()
    const directory = createDirectoryItem('dir-root')
    const sitemap = createSitemapItem()
    const childFile = createFileItem('file-child', directory.id)
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([{ type: 'file', data: childFile.data }])
    expandSitemapOwnerToCreateItemsMock.mockRejectedValueOnce(new Error('sitemap expansion failed'))
    knowledgeItemCreateManyInBaseMock.mockResolvedValueOnce({ items: [childFile] })

    await expect(processKnowledgeSources(base, [directory, sitemap])).resolves.toBeUndefined()

    expect(runtimeAddItemsMock).toHaveBeenCalledWith(base, [childFile])
    expect(knowledgeItemUpdateMock).toHaveBeenCalledWith(sitemap.id, {
      status: 'failed',
      error: 'sitemap expansion failed'
    })
    expect(knowledgeItemUpdateMock).not.toHaveBeenCalledWith(directory.id, {
      status: 'failed',
      error: 'sitemap expansion failed'
    })
  })
})
