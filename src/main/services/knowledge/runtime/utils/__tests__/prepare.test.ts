import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  expandDirectoryOwnerToTreeMock,
  expandSitemapOwnerToCreateItemsMock,
  knowledgeItemCreateMock,
  knowledgeItemUpdateStatusMock
} = vi.hoisted(() => ({
  expandDirectoryOwnerToTreeMock: vi.fn(),
  expandSitemapOwnerToCreateItemsMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    create: knowledgeItemCreateMock,
    updateStatus: knowledgeItemUpdateStatusMock
  }
}))

vi.mock('../../../utils/directory', () => ({
  expandDirectoryOwnerToTree: expandDirectoryOwnerToTreeMock
}))

vi.mock('../../../utils/sitemap', () => ({
  expandSitemapOwnerToCreateItems: expandSitemapOwnerToCreateItemsMock
}))

const { prepareKnowledgeItem } = await import('../prepare')

const baseId = 'kb-1'

function createPrepareOptions(item: KnowledgeItem, onCreatedItem = vi.fn()) {
  const signal = new AbortController().signal
  return {
    baseId,
    item,
    onCreatedItem,
    signal
  }
}

function createDirectoryItem(id = 'dir-1', groupId: string | null = null): KnowledgeItem {
  return {
    id,
    baseId,
    groupId,
    type: 'directory',
    data: { source: id, path: `/docs/${id}` },
    status: 'processing',
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createSitemapItem(): KnowledgeItem {
  return {
    id: 'sitemap-1',
    baseId,
    groupId: null,
    type: 'sitemap',
    data: { source: 'sitemap', url: 'https://example.com/sitemap.xml' },
    status: 'processing',
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createNoteItem(id = 'note-1'): KnowledgeItem {
  return {
    id,
    baseId,
    groupId: null,
    type: 'note',
    data: { source: id, content: `hello ${id}` },
    status: 'processing',
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createFileItem(id = 'file-1', groupId: string | null = null): KnowledgeItem {
  return {
    id,
    baseId,
    groupId,
    type: 'file',
    data: {
      source: `/docs/${id}.md`,
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
    status: 'processing',
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('prepareKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    expandDirectoryOwnerToTreeMock.mockResolvedValue([])
    expandSitemapOwnerToCreateItemsMock.mockResolvedValue([])
    knowledgeItemCreateMock.mockImplementation(async (_baseId: string, item: Partial<KnowledgeItem>) => ({
      id: `${item.type}-created`,
      baseId,
      groupId: item.groupId ?? null,
      type: item.type,
      data: item.data,
      status: 'idle',
      phase: null,
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }))
    knowledgeItemUpdateStatusMock.mockImplementation(
      async (
        id: string,
        status: KnowledgeItem['status'],
        update: { phase?: KnowledgeItem['phase']; error?: string | null } = {}
      ) => ({
        id,
        baseId,
        groupId: null,
        type: id.startsWith('file') ? 'file' : 'note',
        data: { source: id, content: id },
        status,
        phase: update.phase ?? null,
        error: update.error ?? null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      })
    )
  })

  it('returns leaf items directly', async () => {
    const note = createNoteItem()

    await expect(prepareKnowledgeItem(createPrepareOptions(note))).resolves.toEqual([note])

    expect(knowledgeItemCreateMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('expands directory trees and returns only file leaves', async () => {
    const root = createDirectoryItem('dir-root')
    const childDir = createDirectoryItem('dir-child', root.id)
    const childFile = createFileItem('file-child', childDir.id)
    knowledgeItemCreateMock.mockResolvedValueOnce(childDir).mockResolvedValueOnce(childFile)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(childDir).mockResolvedValueOnce(childFile)
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

    const options = createPrepareOptions(root)
    await expect(prepareKnowledgeItem(options)).resolves.toEqual([childFile])

    expect(expandDirectoryOwnerToTreeMock).toHaveBeenCalledWith(root, options.signal)
    expect(knowledgeItemCreateMock).toHaveBeenNthCalledWith(1, baseId, {
      groupId: root.id,
      type: 'directory',
      data: childDir.data
    })
    expect(knowledgeItemCreateMock).toHaveBeenNthCalledWith(2, baseId, {
      groupId: childDir.id,
      type: 'file',
      data: childFile.data
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childDir.id, 'processing', { phase: 'preparing' })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childDir.id, 'processing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childFile.id, 'processing')
  })

  it('clears empty directory preparation phase and returns no leaves', async () => {
    const root = createDirectoryItem('dir-root')
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([])

    await expect(prepareKnowledgeItem(createPrepareOptions(root))).resolves.toEqual([])

    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'processing')
  })

  it('clears empty sitemap preparation phase and returns no leaves', async () => {
    const sitemap = createSitemapItem()
    expandSitemapOwnerToCreateItemsMock.mockResolvedValueOnce([])

    const options = createPrepareOptions(sitemap)
    await expect(prepareKnowledgeItem(options)).resolves.toEqual([])

    expect(expandSitemapOwnerToCreateItemsMock).toHaveBeenCalledWith(sitemap, options.signal)
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(sitemap.id, 'processing')
  })

  it('expands sitemap items into url children and returns url leaves', async () => {
    const sitemap = createSitemapItem()
    const urlChild: KnowledgeItem = {
      id: 'url-child',
      baseId,
      groupId: sitemap.id,
      type: 'url',
      data: { source: 'https://example.com/page-1', url: 'https://example.com/page-1' },
      status: 'processing',
      phase: null,
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }
    expandSitemapOwnerToCreateItemsMock.mockResolvedValueOnce([
      { groupId: sitemap.id, type: 'url', data: urlChild.data }
    ])
    knowledgeItemCreateMock.mockResolvedValueOnce(urlChild)
    knowledgeItemUpdateStatusMock.mockResolvedValueOnce(urlChild)

    await expect(prepareKnowledgeItem(createPrepareOptions(sitemap))).resolves.toEqual([urlChild])

    expect(knowledgeItemCreateMock).toHaveBeenCalledWith(baseId, {
      groupId: sitemap.id,
      type: 'url',
      data: urlChild.data
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(urlChild.id, 'processing')
  })

  it('reports created children before marking them processing', async () => {
    const sitemap = createSitemapItem()
    const urlChild: KnowledgeItem = {
      id: 'url-child',
      baseId,
      groupId: sitemap.id,
      type: 'url',
      data: { source: 'https://example.com/page-1', url: 'https://example.com/page-1' },
      status: 'idle',
      phase: null,
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }
    const onCreatedItem = vi.fn()
    expandSitemapOwnerToCreateItemsMock.mockResolvedValueOnce([
      { groupId: sitemap.id, type: 'url', data: urlChild.data }
    ])
    knowledgeItemCreateMock.mockResolvedValueOnce(urlChild)
    knowledgeItemUpdateStatusMock.mockRejectedValueOnce(new Error('status failed'))

    await expect(prepareKnowledgeItem(createPrepareOptions(sitemap, onCreatedItem))).rejects.toThrow('status failed')

    expect(onCreatedItem).toHaveBeenCalledWith(urlChild)
  })

  it('stops creating children when the runtime signal is aborted after expansion', async () => {
    const sitemap = createSitemapItem()
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    expandSitemapOwnerToCreateItemsMock.mockImplementationOnce(async () => {
      controller.abort(abortError)
      return [
        {
          groupId: sitemap.id,
          type: 'url',
          data: { source: 'https://example.com/page-1', url: 'https://example.com/page-1' }
        }
      ]
    })

    await expect(
      prepareKnowledgeItem({
        ...createPrepareOptions(sitemap),
        signal: controller.signal
      })
    ).rejects.toBe(abortError)

    expect(knowledgeItemCreateMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('propagates expansion failures without marking the source failed', async () => {
    const sitemap = createSitemapItem()
    expandSitemapOwnerToCreateItemsMock.mockRejectedValueOnce(new Error('sitemap expansion failed'))

    await expect(prepareKnowledgeItem(createPrepareOptions(sitemap))).rejects.toThrow('sitemap expansion failed')

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(sitemap.id, 'failed', {
      error: 'sitemap expansion failed'
    })
  })
})
