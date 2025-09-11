import { Model, ModelTag } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { getModelTags, isFreeModel } from '../model'

// Mock the model checking functions from @renderer/config/models
vi.mock('@renderer/config/models', () => ({
  isVisionModel: vi.fn().mockImplementation((m: Model) => m.id === 'vision'),
  isEmbeddingModel: vi.fn().mockImplementation((m: Model) => m.id === 'embedding'),
  isReasoningModel: vi.fn().mockImplementation((m: Model) => m.id === 'reasoning'),
  isFunctionCallingModel: vi.fn().mockImplementation((m: Model) => m.id === 'tool'),
  isWebSearchModel: vi.fn().mockImplementation((m: Model) => m.id === 'search'),
  isRerankModel: vi.fn().mockImplementation((m: Model) => m.id === 'rerank')
}))

describe('model', () => {
  describe('isFreeModel', () => {
    const base = { provider: '', group: '' }
    it('should return true if id or name contains "free" (case-insensitive)', () => {
      expect(isFreeModel({ id: 'free-model', name: 'test', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'FreePlan', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'notfree', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'test', ...base })).toBe(false)
    })

    it('should handle empty id or name', () => {
      expect(isFreeModel({ id: '', name: 'free', ...base })).toBe(true)
      expect(isFreeModel({ id: 'free', name: '', ...base })).toBe(true)
      expect(isFreeModel({ id: '', name: '', ...base })).toBe(false)
    })
  })

  describe('getModelTags', () => {
    const baseModel: Model = {
      id: 'test',
      provider: 'test',
      group: 'test',
      name: 'test'
    }
    const visionModel: Model = {
      ...baseModel,
      id: 'vision'
    }
    const embeddingModel: Model = {
      ...baseModel,
      id: 'embedding'
    }
    const reasoningModel: Model = {
      ...baseModel,
      id: 'reasoning'
    }
    const searchModel: Model = {
      ...baseModel,
      id: 'search'
    }
    const rerankModel: Model = {
      ...baseModel,
      id: 'rerank'
    }
    const toolModel: Model = {
      ...baseModel,
      id: 'tool'
    }
    const freeModel: Model = {
      ...baseModel,
      id: 'free'
    }

    it('should get correct tags', () => {
      const models_1 = [visionModel, embeddingModel, reasoningModel, searchModel]
      const expected_1: Record<ModelTag, boolean> = {
        vision: true,
        embedding: true,
        reasoning: true,
        rerank: false,
        free: false,
        function_calling: false,
        web_search: true
      }
      expect(getModelTags(models_1)).toStrictEqual(expected_1)

      const models_2 = [rerankModel, toolModel, freeModel]
      const expected_2: Record<ModelTag, boolean> = {
        vision: false,
        embedding: false,
        reasoning: false,
        rerank: true,
        free: true,
        function_calling: true,
        web_search: false
      }
      expect(getModelTags(models_2)).toStrictEqual(expected_2)
    })
  })
})
