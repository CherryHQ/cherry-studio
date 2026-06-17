import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../storage/pathStorage'

const { knowledgeFileExistsMock, knowledgeSourcePathExistsMock } = vi.hoisted(() => ({
  knowledgeFileExistsMock: vi.fn(),
  knowledgeSourcePathExistsMock: vi.fn()
}))

vi.mock('../storage/pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../storage/pathStorage')
  return {
    ...actual,
    knowledgeFileExists: knowledgeFileExistsMock,
    knowledgeSourcePathExists: knowledgeSourcePathExistsMock
  }
})

const { canKnowledgeItemRebuildSource, filterIndexableKnowledgeItems, isIndexableKnowledgeItem } = await import(
  '../items'
)

function createItem(type: KnowledgeItem['type']): KnowledgeItem {
  const base = {
    id: `${type}-1`,
    baseId: 'kb-1',
    groupId: null,
    status: 'idle',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  } as const

  switch (type) {
    case 'file':
      return {
        ...base,
        type,
        data: { source: '/docs/file.md', relativePath: 'file.md' }
      }
    case 'url':
      return { ...base, type, data: { source: 'https://example.com', url: 'https://example.com' } }
    case 'note':
      return { ...base, type, data: { source: 'note', content: 'note' } }
    case 'directory':
      return { ...base, type, data: { source: '/docs', path: '/docs' } }
  }
}

describe('indexable knowledge item helpers', () => {
  it('recognizes file, url, and note as indexable leaves', () => {
    const items = ['file', 'url', 'note', 'directory'].map((type) => createItem(type as KnowledgeItem['type']))

    expect(items.map((item) => isIndexableKnowledgeItem(item))).toEqual([true, true, true, false])
    expect(filterIndexableKnowledgeItems(items).map((item) => item.type)).toEqual(['file', 'url', 'note'])
  })
})

describe('canKnowledgeItemRebuildSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledgeFileExistsMock.mockResolvedValue(true)
    knowledgeSourcePathExistsMock.mockResolvedValue(true)
  })

  it('checks a directory against its original folder path', async () => {
    knowledgeSourcePathExistsMock.mockResolvedValue(false)

    await expect(canKnowledgeItemRebuildSource('kb-1', createItem('directory'))).resolves.toBe(false)
    expect(knowledgeSourcePathExistsMock).toHaveBeenCalledWith('/docs')
    expect(knowledgeFileExistsMock).not.toHaveBeenCalled()
  })

  it('checks a file against its material file, preferring indexedRelativePath', async () => {
    const file: KnowledgeItemOf<'file'> = {
      ...(createItem('file') as KnowledgeItemOf<'file'>),
      data: { source: '/docs/file.md', relativePath: 'file.md', indexedRelativePath: 'processed/file.md' }
    }

    await expect(canKnowledgeItemRebuildSource('kb-1', file)).resolves.toBe(true)
    expect(knowledgeFileExistsMock).toHaveBeenCalledWith('kb-1', 'processed/file.md')
    expect(knowledgeSourcePathExistsMock).not.toHaveBeenCalled()
  })

  it('treats note and url items as always rebuildable without touching disk', async () => {
    await expect(canKnowledgeItemRebuildSource('kb-1', createItem('note'))).resolves.toBe(true)
    await expect(canKnowledgeItemRebuildSource('kb-1', createItem('url'))).resolves.toBe(true)
    expect(knowledgeFileExistsMock).not.toHaveBeenCalled()
    expect(knowledgeSourcePathExistsMock).not.toHaveBeenCalled()
  })
})
