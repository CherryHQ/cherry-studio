import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isSelectableAssistantModel } from '../assistantModelFilter'

const isEmbeddingModelMock = vi.hoisted(() => vi.fn())
const isRerankModelMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: isEmbeddingModelMock,
  isRerankModel: isRerankModelMock
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    group: 'default',
    owned_by: 'openai',
    ...overrides
  } as Model
}

describe('isSelectableAssistantModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isEmbeddingModelMock.mockReturnValue(false)
    isRerankModelMock.mockReturnValue(false)
  })

  it('rejects embedding models', () => {
    isEmbeddingModelMock.mockReturnValue(true)

    expect(isSelectableAssistantModel(createModel())).toBe(false)
  })

  it('rejects rerank models', () => {
    isRerankModelMock.mockReturnValue(true)

    expect(isSelectableAssistantModel(createModel())).toBe(false)
  })

  it('accepts chat-capable models', () => {
    expect(isSelectableAssistantModel(createModel())).toBe(true)
  })
})
