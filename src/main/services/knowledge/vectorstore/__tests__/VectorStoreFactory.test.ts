import path from 'node:path'

import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it, vi } from 'vitest'

const vectorStoreMocks = vi.hoisted(() => ({
  constructorSpy: vi.fn()
}))

vi.mock('@vectorstores/libsql', () => ({
  LibSQLVectorStore: class {
    constructor(init: unknown) {
      vectorStoreMocks.constructorSpy(init)
    }
  }
}))

vi.mock('@main/utils', () => ({
  getDataPath: () => '/tmp/cherry-data'
}))

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (value: string, replacement: string) => value.replaceAll('/', replacement)
}))

const { VectorStoreFactory } = await import('../VectorStoreFactory')

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'base/1',
    name: 'Knowledge Base',
    dimensions: 1536,
    embeddingModelId: 'openai::text-embedding-3-small',
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
    ...overrides
  }
}

describe('VectorStoreFactory', () => {
  it('maps collection and dimensions from the knowledge base', () => {
    vectorStoreMocks.constructorSpy.mockClear()

    VectorStoreFactory.create(createBase())

    expect(vectorStoreMocks.constructorSpy).toHaveBeenCalledWith({
      collection: 'base/1',
      dimensions: 1536,
      clientConfig: {
        url: `file://${path.join('/tmp/cherry-data', 'KnowledgeBase', 'base_1')}`
      }
    })
  })
})
