import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  chooseDirectoryPathPrefixMock,
  expandDirectoryOwnerToTreeMock,
  knowledgeItemCreateActiveMock,
  knowledgeItemUpdateStatusMock,
  knowledgeItemUpdateDirectoryRelativePathMock,
  knowledgeItemGetItemsByBaseIdMock,
  loggerWarnMock
} = vi.hoisted(() => ({
  chooseDirectoryPathPrefixMock: vi.fn(),
  expandDirectoryOwnerToTreeMock: vi.fn(),
  knowledgeItemCreateActiveMock: vi.fn(),
  knowledgeItemUpdateStatusMock: vi.fn(),
  knowledgeItemUpdateDirectoryRelativePathMock: vi.fn(),
  knowledgeItemGetItemsByBaseIdMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    createActive: knowledgeItemCreateActiveMock,
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

vi.mock('../../pipeline/sources/directory', () => ({
  chooseDirectoryPathPrefix: chooseDirectoryPathPrefixMock,
  expandDirectoryOwnerToTree: expandDirectoryOwnerToTreeMock
}))

import type { PrepareKnowledgeItemOptions } from '../prepareItem'

const { prepareKnowledgeItem } = await import('../prepareItem')

const baseId = 'kb-1'

function createPrepareOptions(item: KnowledgeItem): PrepareKnowledgeItemOptions {
  const signal = new AbortController().signal
  return {
    baseId,
    item,
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

    chooseDirectoryPathPrefixMock.mockReturnValue('docs')
    expandDirectoryOwnerToTreeMock.mockResolvedValue([])
    knowledgeItemGetItemsByBaseIdMock.mockReturnValue([])
    knowledgeItemCreateActiveMock.mockImplementation((_baseId: string, item: Partial<KnowledgeItem>) => ({
      id: `${item.type}-created`,
      baseId,
      groupId: item.groupId ?? null,
      type: item.type,
      data: item.data,
      status: item.type === 'directory' ? 'preparing' : 'processing',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }))
    knowledgeItemUpdateStatusMock.mockImplementation(
      (id: string, status: KnowledgeItem['status'], update: { error?: string | null } = {}) => ({
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

    expect(knowledgeItemCreateActiveMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })

  it('expands directory trees and returns only file leaves', async () => {
    const root = createDirectoryItem('dir-root')
    const childDir = createDirectoryItem('dir-child', root.id)
    const childFile = createFileItem('file-child', childDir.id)
    knowledgeItemCreateActiveMock.mockReturnValueOnce(childDir).mockReturnValueOnce(childFile)
    chooseDirectoryPathPrefixMock.mockReturnValueOnce('dir-root-prefix')
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

    expect(expandDirectoryOwnerToTreeMock).toHaveBeenCalledWith(root, baseId, 'dir-root-prefix', options.signal)
    expect(knowledgeItemUpdateDirectoryRelativePathMock).toHaveBeenCalledWith(root.id, 'dir-root-prefix')
    // The container prefix must be pinned BEFORE any byte is copied (expansion) or any child
    // row is created, so a mid-expansion crash leaves the pinned row for the retry to reclaim.
    expect(knowledgeItemUpdateDirectoryRelativePathMock.mock.invocationCallOrder[0]).toBeLessThan(
      expandDirectoryOwnerToTreeMock.mock.invocationCallOrder[0]
    )
    expect(knowledgeItemUpdateDirectoryRelativePathMock.mock.invocationCallOrder[0]).toBeLessThan(
      knowledgeItemCreateActiveMock.mock.invocationCallOrder[0]
    )
    expect(knowledgeItemCreateActiveMock).toHaveBeenNthCalledWith(1, baseId, {
      groupId: root.id,
      type: 'directory',
      data: childDir.data
    })
    expect(knowledgeItemCreateActiveMock).toHaveBeenNthCalledWith(2, baseId, {
      groupId: childDir.id,
      type: 'file',
      data: childFile.data
    })
    // `childDir` is a directory: it's created active as `preparing` by `createActive`,
    // then flipped to `processing` once its own children finish being created.
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(childDir.id, 'processing')
  })

  it('excludes the container itself from the reserved names so a reindex keeps its own prefix', () => {
    // On reindex the directory already owns its `relativePath` prefix (`docs`). If it
    // counted itself as reserved, expansion would dedupe it to `docs_1` every run.
    const root = createDirectoryItem('dir-root')
    // Pin the container's own prefix, as if it had already been indexed once.
    root.data = { source: '/abs/docs', relativePath: 'docs' }
    const sibling = createFileItem('file-sibling') // top-level relativePath `file-sibling.md`
    knowledgeItemGetItemsByBaseIdMock.mockReturnValueOnce([root, sibling])
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([
      { type: 'file', data: { source: '/abs/docs/a.md', relativePath: 'docs/a.md' } }
    ])

    return prepareKnowledgeItem(createPrepareOptions(root)).then(() => {
      const reserved = chooseDirectoryPathPrefixMock.mock.calls[0][1] as Set<string>
      expect(reserved.has('docs')).toBe(false)
      // Sibling names are still reserved — only the container under reindex is exempt.
      expect(reserved.has('file-sibling.md')).toBe(true)
    })
  })

  it('marks empty directory roots failed and returns no leaves', async () => {
    const root = createDirectoryItem('dir-root')
    chooseDirectoryPathPrefixMock.mockReturnValueOnce('dir-root')
    expandDirectoryOwnerToTreeMock.mockResolvedValueOnce([])

    await expect(prepareKnowledgeItem(createPrepareOptions(root))).resolves.toEqual([])

    expect(loggerWarnMock).toHaveBeenCalledWith('Directory expansion produced no indexable files', {
      baseId,
      itemId: root.id,
      source: root.data.source
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Directory contains no indexable files'
    })
    // Pin now precedes the empty check (pin-first crash-safety), so an empty dir still
    // reserves its top-level name — a failure-path change we accept as more correct.
    expect(knowledgeItemUpdateDirectoryRelativePathMock).toHaveBeenCalledWith(root.id, 'dir-root')
  })

  it('stops creating children when the runtime signal is aborted after expansion', async () => {
    const root = createDirectoryItem('dir-root')
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    expandDirectoryOwnerToTreeMock.mockImplementationOnce(async () => {
      controller.abort(abortError)
      return [
        {
          type: 'file',
          data: {
            source: '/docs/file-child.md',
            relativePath: 'file-child.md'
          }
        }
      ]
    })

    await expect(
      prepareKnowledgeItem({
        ...createPrepareOptions(root),
        signal: controller.signal
      })
    ).rejects.toBe(abortError)

    expect(knowledgeItemCreateActiveMock).not.toHaveBeenCalled()
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
