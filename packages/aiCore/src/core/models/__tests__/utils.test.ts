import type { LanguageModelV2, LanguageModelV3 } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { AiSdkModel } from '../../providers'
import { hasModelId, isV2Model, isV3Model } from '../utils'

describe('Model Type Guards', () => {
  describe('isV2Model', () => {
    it('should return true for V2 models', () => {
      const v2Model: AiSdkModel = {
        specificationVersion: 'v2',
        modelId: 'test-model',
        provider: 'test-provider'
      } as LanguageModelV2

      expect(isV2Model(v2Model)).toBe(true)
    })

    it('should return false for V3 models', () => {
      const v3Model: AiSdkModel = {
        specificationVersion: 'v3',
        modelId: 'test-model',
        provider: 'test-provider'
      } as LanguageModelV3

      expect(isV2Model(v3Model)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(isV2Model('model-id' as any)).toBe(false)
      expect(isV2Model(null as any)).toBe(false)
      expect(isV2Model(undefined as any)).toBe(false)
      expect(isV2Model(123 as any)).toBe(false)
    })

    it('should return false for objects without specificationVersion', () => {
      const invalidModel = {
        modelId: 'test-model',
        provider: 'test-provider'
      } as any

      expect(isV2Model(invalidModel)).toBe(false)
    })
  })

  describe('isV3Model', () => {
    it('should return true for V3 models', () => {
      const v3Model: AiSdkModel = {
        specificationVersion: 'v3',
        modelId: 'test-model',
        provider: 'test-provider'
      } as LanguageModelV3

      expect(isV3Model(v3Model)).toBe(true)
    })

    it('should return false for V2 models', () => {
      const v2Model: AiSdkModel = {
        specificationVersion: 'v2',
        modelId: 'test-model',
        provider: 'test-provider'
      } as LanguageModelV2

      expect(isV3Model(v2Model)).toBe(false)
    })

    it('should return false for non-object values', () => {
      expect(isV3Model('model-id' as any)).toBe(false)
      expect(isV3Model(null as any)).toBe(false)
      expect(isV3Model(undefined as any)).toBe(false)
    })

    it('should return false for objects without specificationVersion', () => {
      const invalidModel = {
        modelId: 'test-model',
        provider: 'test-provider'
      } as any

      expect(isV3Model(invalidModel)).toBe(false)
    })
  })

  describe('Type Guard Correctness', () => {
    it('should correctly distinguish between V2 and V3 models', () => {
      const v2Model: AiSdkModel = {
        specificationVersion: 'v2',
        modelId: 'v2-model'
      } as LanguageModelV2

      const v3Model: AiSdkModel = {
        specificationVersion: 'v3',
        modelId: 'v3-model'
      } as LanguageModelV3

      // V2 model should only match isV2Model
      expect(isV2Model(v2Model)).toBe(true)
      expect(isV3Model(v2Model)).toBe(false)

      // V3 model should only match isV3Model
      expect(isV2Model(v3Model)).toBe(false)
      expect(isV3Model(v3Model)).toBe(true)
    })

    it('should narrow type correctly for V2 models', () => {
      const model: AiSdkModel = {
        specificationVersion: 'v2',
        modelId: 'test'
      } as LanguageModelV2

      if (isV2Model(model)) {
        expect(model.specificationVersion).toBe('v2')
      }
    })

    it('should narrow type correctly for V3 models', () => {
      const model: AiSdkModel = {
        specificationVersion: 'v3',
        modelId: 'test'
      } as LanguageModelV3

      if (isV3Model(model)) {
        expect(model.specificationVersion).toBe('v3')
      }
    })
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

    it('should narrow type correctly', () => {
      const unknownValue: unknown = { modelId: 'test-id' }

      if (hasModelId(unknownValue)) {
        // TypeScript should allow accessing modelId as string
        expect(typeof unknownValue.modelId).toBe('string')
        expect(unknownValue.modelId).toBe('test-id')
      }
    })
  })
})
