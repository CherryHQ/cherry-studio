/**
 * image.ts Unit Tests
 * Tests for Gemini image generation utilities
 */

import { describe, expect, it } from 'vitest'

import { buildGeminiGenerateImageParams } from '../image'

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
})
