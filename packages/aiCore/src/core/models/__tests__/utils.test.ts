import type { LanguageModelV2 } from '@ai-sdk/provider'
import { createMockImageModel, createMockLanguageModel } from '@test-utils'
import { describe, expect, it } from 'vitest'

import { hasModelId, isImageModelV3, isV2Model, isV3Model } from '../utils'

describe('Model Type Guards', () => {
  it('distinguishes complete V2 and V3 language models', () => {
    const legacy: LanguageModelV2 = {
      specificationVersion: 'v2',
      provider: 'test',
      modelId: 'legacy',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Not used by type classification')
      },
      doStream: async () => {
        throw new Error('Not used by type classification')
      }
    }
    const current = createMockLanguageModel()

    expect(isV2Model(legacy)).toBe(true)
    expect(isV3Model(legacy)).toBe(false)
    expect(isV2Model(current)).toBe(false)
    expect(isV3Model(current)).toBe(true)
  })

  it('distinguishes V3 image and language models even when the image limit is undefined', () => {
    const image = createMockImageModel({ maxImagesPerCall: undefined })
    const language = createMockLanguageModel()

    expect(isV3Model(image)).toBe(false)
    expect(isV2Model(image)).toBe(false)
    expect(isImageModelV3(image)).toBe(true)
    expect(isImageModelV3(language)).toBe(false)
  })

  it('does not classify unresolved model IDs as SDK model objects', () => {
    expect(isV2Model('model-id')).toBe(false)
    expect(isV3Model('model-id')).toBe(false)
    expect(isImageModelV3('model-id')).toBe(false)
  })

  describe('hasModelId', () => {
    it('should return true for objects with modelId string property', () => {
      const modelWithId = {
        modelId: 'test-model-id',
        other: 'property'
      }

      expect(hasModelId(modelWithId)).toBe(true)
    })

    it('should return false for objects without modelId property', () => {
      const modelWithoutId = {
        other: 'property'
      }

      expect(hasModelId(modelWithoutId)).toBe(false)
    })

    it('should return false for objects with non-string modelId', () => {
      const modelWithNumericId = {
        modelId: 123
      }

      expect(hasModelId(modelWithNumericId)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(hasModelId(null)).toBe(false)
      expect(hasModelId(undefined)).toBe(false)
      expect(hasModelId('string')).toBe(false)
      expect(hasModelId(123)).toBe(false)
      expect(hasModelId(true)).toBe(false)
    })
  })
})
