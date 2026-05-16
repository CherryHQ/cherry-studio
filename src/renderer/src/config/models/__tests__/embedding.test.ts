import type { Model as V1Model } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
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

import { toSharedCompatModel } from '../_bridge'
import { isEmbeddingModel, isRerankModel } from '../embedding'

const createModel = (overrides: Partial<V1Model> = {}): Model =>
  toSharedCompatModel({
    id: 'test-model',
    name: 'Test Model',
    provider: 'openai',
    group: 'Test',
    ...overrides
  } as V1Model)

describe('isEmbeddingModel', () => {
  it('returns true for ids that match the embedding regex', () => {
    expect(isEmbeddingModel(createModel({ id: 'Text-Embedding-3-Small' }))).toBe(true)
  })

  it('returns false for rerank models even if they match embedding patterns', () => {
    const model = createModel({ id: 'rerank-qa', name: 'rerank-qa' })
    expect(isRerankModel(model)).toBe(true)
    expect(isEmbeddingModel(model)).toBe(false)
  })

  it('honors the authoritative v2 capabilities (user-disabled = absent)', () => {
    const model: Model = { ...createModel({ id: 'text-embedding-3-small' }), capabilities: [] }
    expect(isEmbeddingModel(model)).toBe(false)
  })

  it('reads the EMBEDDING capability for doubao embedding models', () => {
    const model: Model = {
      ...createModel({ id: 'doubao-embedding', provider: 'doubao' }),
      capabilities: [MODEL_CAPABILITY.EMBEDDING]
    }
    expect(isEmbeddingModel(model)).toBe(true)
  })
})

describe('isRerankModel', () => {
  it('identifies ids that match rerank regex', () => {
    expect(isRerankModel(createModel({ id: 'jina-rerank-v2-base' }))).toBe(true)
  })

  it('honors the authoritative v2 capabilities (user-disabled = absent)', () => {
    const model: Model = { ...createModel({ id: 'jina-rerank-v2-base' }), capabilities: [] }
    expect(isRerankModel(model)).toBe(false)
  })
})
