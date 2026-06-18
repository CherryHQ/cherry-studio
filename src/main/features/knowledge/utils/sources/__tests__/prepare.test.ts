import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  expandDirectoryOwnerToTreeMock,
  knowledgeItemCreateMock,
  knowledgeItemUpdateStatusMock,
  knowledgeItemUpdateDirectoryRelativePathMock,
  knowledgeItemGetItemsByBaseIdMock,
  loggerWarnMock
} = vi.hoisted(() => ({
  expandDirectoryOwnerToTreeMock: vi.fn(),
  knowledgeItemCreateMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  knowledgeItemUpdateDirectoryRelativePathMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    create: knowledgeItemCreateMock,
    updateStatus: knowledgeItemUpdateStatusMock,
    updateDirectoryRelativePath: knowledgeItemUpdateDirectoryRelativePathMock,
    getItemsByBaseId: knowledgeItemGetItemsByBaseIdMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarnMock
    })
  }
}))

vi.mock('../directory', () => ({
  expandDirectoryOwnerToTree: expandDirectoryOwnerToTreeMock
}))

import type { PrepareKnowledgeItemOptions } from '../prepare'

const { prepareKnowledgeItem } = await import('../prepare')

const baseId = 'kb-1'

function createPrepareOptions(item: KnowledgeItem, onCreatedItem = vi.fn()): PrepareKnowledgeItemOptions {
  const signal = new AbortController().signal
  return {
    baseId,
    item,
    onCreatedItem,
    runMutation: async (task) => await task(),
    signal
  }
}

function createDirectoryItem(id = 'dir-1', groupId: string | null = null): KnowledgeItem {
  return {
    id,
    baseId,
    groupId,
    type: 'directory',
    data: { source: id },
    status: 'processing',
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
      relativePath: `${id}.md`
    },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('prepareKnowledgeItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    expandDirectoryOwnerToTreeMock.mockResolvedValue({ pathPrefix: 'docs', children: [] })
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValue([])
    knowledgeItemCreateMock.mockImplementation(async (_baseId: string, item: Partial<KnowledgeItem>) => ({
      id: `${item.type}-created`,
      baseId,
      groupId: item.groupId ?? null,
      type: item.type,
      data: item.data,
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }))
    knowledgeItemUpdateStatusMock.mockImplementation(
      async (id: string, status: KnowledgeItem['status'], update: { error?: string | null } = {}) => ({
        id,
        baseId,
        groupId: null,
        type: id.startsWith('file') ? 'file' : 'note',
        data: { source: id, content: id },
        status,
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
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce({
      pathPrefix: 'dir-root-prefix',
      children: [
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
      ]
    })

    const options = createPrepareOptions(root)
    await expect(prepareKnowledgeItem(options)).resolves.toEqual([childFile])

    expect(expandDirectoryOwnerToTreeMock).toHaveBeenCalledWith(root, baseId, expect.any(Set), options.signal)
    expect(knowledgeItemUpdateDirectoryRelativePathMock).toHaveBeenCalledWith(root.id, 'dir-root-prefix')
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
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childDir.id, 'preparing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childDir.id, 'processing')
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childFile.id, 'processing')
  })

  it('excludes the container itself from the reserved names so a reindex keeps its own prefix', () => {
    // On reindex the directory already owns its `relativePath` prefix (`docs`). If it
    // counted itself as reserved, expansion would dedupe it to `docs_1` every run.
    const root = createDirectoryItem('dir-root')
    // Pin the container's own prefix, as if it had already been indexed once.
    root.data = { source: '/abs/docs', relativePath: 'docs' }
    const sibling = createFileItem('file-sibling') // top-level relativePath `file-sibling.md`
    knowledgeItemGetItemsByBaseIdMock.mockResolvedValueOnce([root, sibling])
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce({
      pathPrefix: 'docs',
      children: [{ type: 'file', data: { source: '/abs/docs/a.md', relativePath: 'docs/a.md' } }]
    })

    return prepareKnowledgeItem(createPrepareOptions(root)).then(() => {
      const reserved = expandDirectoryOwnerToTreeMock.mock.calls[0][2] as Set<string>
      expect(reserved.has('docs')).toBe(false)
      // Sibling names are still reserved — only the container under reindex is exempt.
      expect(reserved.has('file-sibling.md')).toBe(true)
    })
  })

  it('marks empty directory roots failed and returns no leaves', async () => {
    const root = createDirectoryItem('dir-root')
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce({ pathPrefix: 'dir-root', children: [] })

    await expect(prepareKnowledgeItem(createPrepareOptions(root))).resolves.toEqual([])

    expect(loggerWarnMock).toHaveBeenCalledWith('Directory expansion produced no indexable files', {
      baseId,
      itemId: root.id,
      source: root.data.source
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Directory contains no indexable files'
    })
    expect(knowledgeItemUpdateDirectoryRelativePathMock).not.toHaveBeenCalled()
  })

  it('reports created children before marking them processing', async () => {
    const root = createDirectoryItem('dir-root')
    const fileChild: KnowledgeItem = {
      id: 'file-child',
      baseId,
      groupId: root.id,
      type: 'file',
      data: {
        source: '/docs/file-child.md',
        relativePath: 'file-child.md'
      },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }
    const onCreatedItem = vi.fn()
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce({
      pathPrefix: 'dir-root',
      children: [{ type: 'file', data: fileChild.data }]
    })
    knowledgeItemCreateMock.mockResolvedValueOnce(fileChild)
    knowledgeItemUpdateStatusMock.mockRejectedValueOnce(new Error('status failed'))

    await expect(prepareKnowledgeItem(createPrepareOptions(root, onCreatedItem))).rejects.toThrow('status failed')

    expect(onCreatedItem).toHaveBeenCalledWith(fileChild)
  })

  it('stops creating children when the runtime signal is aborted after expansion', async () => {
    const root = createDirectoryItem('dir-root')
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    expandDirectoryOwnerToTreeMock.mockImplementationOnce(async () => {
      controller.abort(abortError)
      return {
        pathPrefix: 'dir-root',
        children: [
          {
            type: 'file',
            data: {
              source: '/docs/file-child.md',
              relativePath: 'file-child.md'
            }
          }
        ]
      }
    })

    await expect(
      prepareKnowledgeItem({
        ...createPrepareOptions(root),
        signal: controller.signal
      })
    ).rejects.toBe(abortError)

    expect(knowledgeItemCreateMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('propagates expansion failures without marking the source failed', async () => {
    const root = createDirectoryItem('dir-root')
    expandDirectoryOwnerToTreeMock.mockRejectedValueOnce(new Error('directory expansion failed'))

    await expect(prepareKnowledgeItem(createPrepareOptions(root))).rejects.toThrow('directory expansion failed')

    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalledWith(root.id, 'failed', {
      error: 'directory expansion failed'
    })
  })
})
