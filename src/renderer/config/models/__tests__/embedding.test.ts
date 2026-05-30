import type { Model } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      llm: { providers: [] },
      settings: {}
    })
  },
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn()
}))

vi.mock('@renderer/store/settings', () => {
  const noop = vi.fn()
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'initialState') {
          return {}
        }
        return noop
      }
    }
  )
})

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left' })),
  useMessageStyle: vi.fn(() => ({ isBubbleStyle: false })),
  getStoreSetting: vi.fn()
}))

import { isEmbeddingModel, isRerankModel } from '../embedding'

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'test-model',
  name: 'Test Model',
  provider: 'openai',
  group: 'Test',
  ...overrides
})

describe('isEmbeddingModel', () => {
  it('returns true for ids that match the embedding regex', () => {
    expect(isEmbeddingModel(createModel({ id: 'Text-Embedding-3-Small' }))).toBe(true)
  })

  it('returns false for rerank models even if they match embedding patterns', () => {
    const model = createModel({ id: 'rerank-qa', name: 'rerank-qa' })
    expect(isRerankModel(model)).toBe(true)
    expect(isEmbeddingModel(model)).toBe(false)
  })

  it('honors user overrides for embedding capability', () => {
    const model = createModel({
      id: 'text-embedding-3-small',
      capabilities: [{ type: 'embedding', isUserSelected: false }]
    })
    expect(isEmbeddingModel(model)).toBe(false)
  })

  it('uses the model name when provider is doubao', () => {
    const model = createModel({
      id: 'custom-id',
      name: 'BGE-Large-zh-v1.5',
      provider: 'doubao'
    })
    expect(isEmbeddingModel(model)).toBe(true)
  })

  it('returns false for anthropic provider models', () => {
    const model = createModel({
      id: 'text-embedding-ada-002',
      provider: 'anthropic'
    })
    expect(isEmbeddingModel(model)).toBe(false)
  })
})

describe('isRerankModel', () => {
  it('identifies ids that match rerank regex', () => {
    expect(isRerankModel(createModel({ id: 'jina-rerank-v2-base' }))).toBe(true)
  })

  it('honors user overrides for rerank capability', () => {
    const model = createModel({
      id: 'jina-rerank-v2-base',
      capabilities: [{ type: 'rerank', isUserSelected: false }]
    })
    expect(isRerankModel(model)).toBe(false)
  })
})
