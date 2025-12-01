/**
 * image.ts Unit Tests
 * Tests for Gemini image generation utilities
 */

import type { Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { buildGeminiGenerateImageParams, isOpenRouterGeminiGenerateImageModel } from '../image'

describe('image utils', () => {
  describe('buildGeminiGenerateImageParams', () => {
    it('should return correct response modalities', () => {
      const result = buildGeminiGenerateImageParams()

      expect(result).toEqual({
        responseModalities: ['TEXT', 'IMAGE']
      })
    })

    it('should return an object with responseModalities property', () => {
      const result = buildGeminiGenerateImageParams()

      expect(result).toHaveProperty('responseModalities')
      expect(Array.isArray(result.responseModalities)).toBe(true)
      expect(result.responseModalities).toHaveLength(2)
    })
  })

  describe('isOpenRouterGeminiGenerateImageModel', () => {
    const mockOpenRouterProvider: Provider = {
      id: SystemProviderIds.openrouter,
      name: 'OpenRouter',
      apiKey: 'test-key',
      apiHost: 'https://openrouter.ai/api/v1',
      isSystem: true
    } as Provider

    const mockOtherProvider: Provider = {
      id: SystemProviderIds.openai,
      name: 'OpenAI',
      apiKey: 'test-key',
      apiHost: 'https://api.openai.com/v1',
      isSystem: true
    } as Provider

    it('should return true for OpenRouter Gemini 2.5 Flash Image model', () => {
      const model: Model = {
        id: 'google/gemini-2.5-flash-image-preview',
        name: 'Gemini 2.5 Flash Image',
        provider: SystemProviderIds.openrouter
      } as Model

      const result = isOpenRouterGeminiGenerateImageModel(model, mockOpenRouterProvider)
      expect(result).toBe(true)
    })

    it('should return false for non-Gemini model on OpenRouter', () => {
      const model: Model = {
        id: 'openai/gpt-4',
        name: 'GPT-4',
        provider: SystemProviderIds.openrouter
      } as Model

      const result = isOpenRouterGeminiGenerateImageModel(model, mockOpenRouterProvider)
      expect(result).toBe(false)
    })

    it('should return false for Gemini model on non-OpenRouter provider', () => {
      const model: Model = {
        id: 'gemini-2.5-flash-image-preview',
        name: 'Gemini 2.5 Flash Image',
        provider: SystemProviderIds.gemini
      } as Model

      const result = isOpenRouterGeminiGenerateImageModel(model, mockOtherProvider)
      expect(result).toBe(false)
    })

    it('should return false for Gemini model without image suffix', () => {
      const model: Model = {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: SystemProviderIds.openrouter
      } as Model

      const result = isOpenRouterGeminiGenerateImageModel(model, mockOpenRouterProvider)
      expect(result).toBe(false)
    })

    it('should handle model ID with partial match', () => {
      const model: Model = {
        id: 'google/gemini-2.5-flash-image-generation',
        name: 'Gemini Image Gen',
        provider: SystemProviderIds.openrouter
      } as Model

      const result = isOpenRouterGeminiGenerateImageModel(model, mockOpenRouterProvider)
      expect(result).toBe(true)
    })

    it('should return false for custom provider', () => {
      const customProvider: Provider = {
        id: 'custom-provider-123',
        name: 'Custom Provider',
        apiKey: 'test-key',
        apiHost: 'https://custom.com'
      } as Provider

      const model: Model = {
        id: 'gemini-2.5-flash-image-preview',
        name: 'Gemini 2.5 Flash Image',
        provider: 'custom-provider-123'
      } as Model

      const result = isOpenRouterGeminiGenerateImageModel(model, customProvider)
      expect(result).toBe(false)
    })
  })
})
