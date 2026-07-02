import type { KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../storage/pathStorage'

const { probeKnowledgeFileMock, probeKnowledgeSourcePathMock } = vi.hoisted(() => ({
  probeKnowledgeFileMock: vi.fn(),
  probeKnowledgeSourcePathMock: vi.fn()
}))

vi.mock('../storage/pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../storage/pathStorage')
  return {
    ...actual,
    probeKnowledgeFile: probeKnowledgeFileMock,
    probeKnowledgeSourcePath: probeKnowledgeSourcePathMock
  }
})

const { canKnowledgeItemRebuildSource, classifyKnowledgeItemSource, isIndexableKnowledgeItem } = await import(
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
      return { ...base, type, data: { source: '/docs' } }
  }
}

describe('indexable knowledge item helpers', () => {
  it('recognizes file, url, and note as indexable leaves', () => {
    const items = ['file', 'url', 'note', 'directory'].map((type) => createItem(type as KnowledgeItem['type']))

    expect(items.map((item) => isIndexableKnowledgeItem(item))).toEqual([true, true, true, false])
  })
})

describe('classifyKnowledgeItemSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    probeKnowledgeFileMock.mockResolvedValue('readable')
    probeKnowledgeSourcePathMock.mockResolvedValue('readable')
  })

  it('checks a directory against its original folder path', async () => {
    probeKnowledgeSourcePathMock.mockResolvedValue('missing')

    await expect(classifyKnowledgeItemSource('kb-1', createItem('directory'))).resolves.toBe('missing')
    expect(probeKnowledgeSourcePathMock).toHaveBeenCalledWith('/docs')
    expect(probeKnowledgeFileMock).not.toHaveBeenCalled()
  })

  it('checks a file against its material file, preferring indexedRelativePath', async () => {
    const file: KnowledgeItemOf<'file'> = {
      ...(createItem('file') as KnowledgeItemOf<'file'>),
      data: { source: '/docs/file.md', relativePath: 'file.md', indexedRelativePath: 'processed/file.md' }
    }

    await expect(classifyKnowledgeItemSource('kb-1', file)).resolves.toBe('rebuildable')
    expect(probeKnowledgeFileMock).toHaveBeenCalledWith('kb-1', 'processed/file.md')
    expect(probeKnowledgeSourcePathMock).not.toHaveBeenCalled()
  })

  it('treats note and url items as always rebuildable without touching disk', async () => {
    await expect(classifyKnowledgeItemSource('kb-1', createItem('note'))).resolves.toBe('rebuildable')
    await expect(classifyKnowledgeItemSource('kb-1', createItem('url'))).resolves.toBe('rebuildable')
    expect(probeKnowledgeFileMock).not.toHaveBeenCalled()
    expect(probeKnowledgeSourcePathMock).not.toHaveBeenCalled()
  })

  it('distinguishes an unverifiable source from a missing one', async () => {
    probeKnowledgeSourcePathMock.mockResolvedValue('unverifiable')

    await expect(classifyKnowledgeItemSource('kb-1', createItem('directory'))).resolves.toBe('unverifiable')
  })
})

describe('canKnowledgeItemRebuildSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    probeKnowledgeFileMock.mockResolvedValue('readable')
    probeKnowledgeSourcePathMock.mockResolvedValue('readable')
  })

  it('is true only for a readable source', async () => {
    await expect(canKnowledgeItemRebuildSource('kb-1', createItem('directory'))).resolves.toBe(true)
  })

  it('is false for both a missing and an unverifiable source', async () => {
    probeKnowledgeSourcePathMock.mockResolvedValueOnce('missing')
    await expect(canKnowledgeItemRebuildSource('kb-1', createItem('directory'))).resolves.toBe(false)

    probeKnowledgeSourcePathMock.mockResolvedValueOnce('unverifiable')
    await expect(canKnowledgeItemRebuildSource('kb-1', createItem('directory'))).resolves.toBe(false)
  })
})
