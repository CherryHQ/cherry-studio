import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/knowledge/KnowledgeOrchestrator', () => ({
  knowledgeOrchestrator: {
    getProgress: vi.fn(),
    process: vi.fn(),
    cancel: vi.fn(),
    clearProgress: vi.fn(),
    removeVectors: vi.fn(),
    isQueued: vi.fn(),
    isProcessing: vi.fn(),
    getQueueStatus: vi.fn(() => ({ perBaseQueue: {} }))
  }
}))

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: vi.fn()
  }
}))

import { buildKnowledgeItemTree } from '../KnowledgeItemService'

const createItem = (overrides: Partial<KnowledgeItem>): KnowledgeItem => ({
  id: 'item-1',
  baseId: 'base-1',
  parentId: null,
  type: 'file',
  data: { file: { name: 'a.txt', path: '/a.txt', size: 10, ext: '.txt' } as any },
  status: 'completed',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides
})

describe('buildKnowledgeItemTree', () => {
  it('builds parent-child structure from flat items', () => {
    const items: KnowledgeItem[] = [
      createItem({ id: 'dir-1', type: 'directory', data: { path: '/dir', recursive: true } as any }),
      createItem({ id: 'file-1', type: 'file', parentId: 'dir-1' }),
      createItem({ id: 'file-2', type: 'file', parentId: 'dir-1' }),
      createItem({ id: 'url-1', type: 'url', data: { url: 'https://example.com', name: 'Example' } as any })
    ]

    const tree = buildKnowledgeItemTree(items)

    expect(tree).toHaveLength(2)

    const directoryNode = tree.find((node) => node.item.id === 'dir-1')
    expect(directoryNode).toBeDefined()
    expect(directoryNode!.children).toHaveLength(2)
    expect(directoryNode!.children.map((child) => child.item.id)).toEqual(expect.arrayContaining(['file-1', 'file-2']))

    const urlNode = tree.find((node) => node.item.id === 'url-1')
    expect(urlNode).toBeDefined()
    expect(urlNode!.children).toHaveLength(0)
  })

  it('returns empty when no root items exist', () => {
    const items: KnowledgeItem[] = [createItem({ id: 'a', parentId: 'b' }), createItem({ id: 'b', parentId: 'a' })]

    const tree = buildKnowledgeItemTree(items)

    expect(tree).toEqual([])
  })
})
