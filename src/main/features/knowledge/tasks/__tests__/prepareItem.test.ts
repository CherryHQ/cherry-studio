import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const {
  chooseDirectoryPathPrefixMock,
  knowledgeItemCreateActiveMock,
  knowledgeItemUpdateStatusMock,
  knowledgeItemUpdateDirectoryRelativePathMock,
  knowledgeItemGetItemsByBaseIdMock,
  loggerWarnMock
} = vi.hoisted(() => ({
  chooseDirectoryPathPrefixMock: vi.fn(),
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
  chooseDirectoryPathPrefix: chooseDirectoryPathPrefixMock
}))

const { createExpandedDirectoryChildren, pinDirectoryPathPrefix } = await import('../prepareItem')

const baseId = 'kb-1'

function createDirectoryItem(id = 'dir-1', groupId: string | null = null): KnowledgeItemOf<'directory'> {
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

function createFileItem(id = 'file-1', groupId: string | null = null): KnowledgeItemOf<'file'> {
  return {
    id,
    baseId,
    groupId,
    type: 'file',
    data: {
      source: `/docs/${id}.md`,
      relativePath: `${id}.md` as PosixRelativeFilePath
    },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('prepareItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    chooseDirectoryPathPrefixMock.mockReturnValue('docs')
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

  it('pins the deduped prefix onto the container and returns it', () => {
    const root = createDirectoryItem('dir-root')
    chooseDirectoryPathPrefixMock.mockReturnValueOnce('dir-root-prefix')

    expect(pinDirectoryPathPrefix(baseId, root)).toBe('dir-root-prefix')

    expect(knowledgeItemUpdateDirectoryRelativePathMock).toHaveBeenCalledWith(root.id, 'dir-root-prefix')
  })

  it('excludes the container itself from the reserved names so a reindex keeps its own prefix', () => {
    // On reindex the directory already owns its `relativePath` prefix (`docs`). If it
    // counted itself as reserved, expansion would dedupe it to `docs_1` every run.
    const root = createDirectoryItem('dir-root')
    // Pin the container's own prefix, as if it had already been indexed once.
    root.data = { source: '/abs/docs', relativePath: 'docs' as PosixRelativeFilePath }
    const sibling = createFileItem('file-sibling') // top-level relativePath `file-sibling.md`
    knowledgeItemGetItemsByBaseIdMock.mockReturnValueOnce([root, sibling])

    pinDirectoryPathPrefix(baseId, root)

    const reserved = chooseDirectoryPathPrefixMock.mock.calls[0][1] as Set<string>
    expect(reserved.has('docs')).toBe(false)
    // Sibling names are still reserved — only the container under reindex is exempt.
    expect(reserved.has('file-sibling.md')).toBe(true)
  })

  it('keeps a deleting directory’s prefix reserved, since its cleanup still removes that folder', () => {
    const deletingDir: KnowledgeItemOf<'directory'> = {
      id: 'dir-deleting',
      baseId,
      groupId: null,
      type: 'directory',
      data: { source: '/old/docs', relativePath: 'docs' as PosixRelativeFilePath },
      status: 'deleting',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    }
    knowledgeItemGetItemsByBaseIdMock.mockImplementation((_baseId: string, options?: { includeDeleting?: boolean }) =>
      options?.includeDeleting ? [deletingDir] : []
    )

    pinDirectoryPathPrefix(baseId, createDirectoryItem('dir-new'))

    const reserved = chooseDirectoryPathPrefixMock.mock.calls[0][1] as Set<string>
    expect(reserved.has('docs')).toBe(true)
  })

  it('creates rows for an expanded tree and returns only file leaves', async () => {
    const root = createDirectoryItem('dir-root')
    const childDir = createDirectoryItem('dir-child', root.id)
    const childFile = createFileItem('file-child', childDir.id)
    knowledgeItemCreateActiveMock.mockReturnValueOnce(childDir).mockReturnValueOnce(childFile)

    await expect(
      createExpandedDirectoryChildren(
        baseId,
        root,
        [{ type: 'directory', data: childDir.data, children: [{ type: 'file', data: childFile.data }] }],
        new AbortController().signal
      )
    ).resolves.toEqual([childFile])

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

  it('marks an empty directory root failed and returns no leaves', async () => {
    const root = createDirectoryItem('dir-root')

    await expect(createExpandedDirectoryChildren(baseId, root, [], new AbortController().signal)).resolves.toEqual([])

    expect(loggerWarnMock).toHaveBeenCalledWith('Directory expansion produced no indexable files', {
      baseId,
      itemId: root.id,
      source: root.data.source
    })
    expect(knowledgeItemUpdateStatusMock).toHaveBeenCalledWith(root.id, 'failed', {
      error: 'Directory contains no indexable files'
    })
  })

  it('creates no children once the runtime signal is aborted', async () => {
    const root = createDirectoryItem('dir-root')
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    controller.abort(abortError)

    await expect(
      createExpandedDirectoryChildren(
        baseId,
        root,
        [
          {
            type: 'file',
            data: { source: '/docs/file-child.md', relativePath: 'file-child.md' as PosixRelativeFilePath }
          }
        ],
        controller.signal
      )
    ).rejects.toBe(abortError)

    expect(knowledgeItemCreateActiveMock).not.toHaveBeenCalled()
    expect(knowledgeItemUpdateStatusMock).not.toHaveBeenCalled()
  })
})
