import { describe, expect, it } from 'vitest'

import {
  getNestedValue,
  isNonEmptyString,
  isValidNumber,
  transformFileProcessingConfig
} from '../PreferenceTransformers'

describe('PreferenceTransformers', () => {
  describe('utility functions', () => {
    describe('getNestedValue', () => {
      it('should get nested value from object', () => {
        const obj = { a: { b: { c: 'value' } } }
        expect(getNestedValue(obj, 'a.b.c')).toBe('value')
      })

      it('should get top-level value', () => {
        const obj = { a: 'value' }
        expect(getNestedValue(obj, 'a')).toBe('value')
      })

      it('should return undefined for non-existent path', () => {
        const obj = { a: { b: 1 } }
        expect(getNestedValue(obj, 'a.b.c')).toBeUndefined()
      })

      it('should return undefined for null object', () => {
        expect(getNestedValue(null, 'a.b')).toBeUndefined()
      })

      it('should return undefined for undefined object', () => {
        expect(getNestedValue(undefined, 'a.b')).toBeUndefined()
      })

      it('should return undefined for non-object', () => {
        expect(getNestedValue('string', 'a')).toBeUndefined()
      })

      it('should return undefined when intermediate path is null', () => {
        const obj = { a: null }
        expect(getNestedValue(obj, 'a.b')).toBeUndefined()
      })

      it('should handle array access', () => {
        const obj = { a: [1, 2, 3] }
        expect(getNestedValue(obj, 'a.1')).toBe(2)
      })
    })

    describe('isValidNumber', () => {
      it('should return true for positive integers', () => {
        expect(isValidNumber(42)).toBe(true)
      })

      it('should return true for zero', () => {
        expect(isValidNumber(0)).toBe(true)
      })

      it('should return true for negative numbers', () => {
        expect(isValidNumber(-1)).toBe(true)
      })

      it('should return true for floating point numbers', () => {
        expect(isValidNumber(3.14)).toBe(true)
      })

      it('should return true for Infinity', () => {
        expect(isValidNumber(Infinity)).toBe(true)
      })

      it('should return true for negative Infinity', () => {
        expect(isValidNumber(-Infinity)).toBe(true)
      })

      it('should return false for NaN', () => {
        expect(isValidNumber(NaN)).toBe(false)
      })

      it('should return false for string numbers', () => {
        expect(isValidNumber('42')).toBe(false)
      })

      it('should return false for null', () => {
        expect(isValidNumber(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isValidNumber(undefined)).toBe(false)
      })

      it('should return false for objects', () => {
        expect(isValidNumber({})).toBe(false)
      })
    })

    describe('isNonEmptyString', () => {
      it('should return true for non-empty strings', () => {
        expect(isNonEmptyString('hello')).toBe(true)
      })

      it('should return true for whitespace-only strings', () => {
        expect(isNonEmptyString(' ')).toBe(true)
      })

      it('should return true for strings with special characters', () => {
        expect(isNonEmptyString('!@#$%')).toBe(true)
      })

      it('should return false for empty string', () => {
        expect(isNonEmptyString('')).toBe(false)
      })

      it('should return false for null', () => {
        expect(isNonEmptyString(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isNonEmptyString(undefined)).toBe(false)
      })

      it('should return false for numbers', () => {
        expect(isNonEmptyString(42)).toBe(false)
      })

      it('should return false for objects', () => {
        expect(isNonEmptyString({})).toBe(false)
      })

      it('should return false for arrays', () => {
        expect(isNonEmptyString(['a'])).toBe(false)
      })
    })
  })

  describe('transformFileProcessingConfig', () => {
    it('should map overrides and preserve defaults', () => {
      const result = transformFileProcessingConfig({
        ocrProviders: [
          {
            id: 'paddleocr',
            name: 'Paddle OCR',
            config: {
              api: {
                apiKey: 'paddle-key',
                apiHost: 'https://ocr.example.com/'
              }
            }
          }
        ],
        ocrImageProviderId: 'paddleocr',
        preprocessProviders: [
          {
            id: 'mistral',
            name: 'Mistral',
            apiKey: 'mistral-key',
            apiHost: 'https://api.mistral.ai',
            model: 'mistral-ocr-latest'
          }
        ],
        preprocessDefaultProvider: 'mistral'
      })

      expect(result['feature.file_processing.overrides']).toEqual({
        paddleocr: {
          apiKeys: ['paddle-key']
        },
        mistral: {
          apiKeys: ['mistral-key']
        }
      })
      expect(result['feature.file_processing.default_text_extraction_processor']).toBe('paddleocr')
      expect(result['feature.file_processing.default_markdown_conversion_processor']).toBe('mistral')
    })

    it('should map accessToken for paddleocr and ignore apiUrl/langs', () => {
      const result = transformFileProcessingConfig({
        ocrProviders: [
          {
            id: 'paddleocr',
            name: 'Paddle OCR',
            config: {
              api: {
                apiKey: 'legacy-key'
              },
              apiUrl: 'https://api.paddle.example.com/',
              accessToken: 'paddle-token',
              langs: {
                eng: true,
                jpn: true,
                chi_sim: false
              }
            }
          }
        ],
        ocrImageProviderId: 'paddleocr'
      })

      expect(result['feature.file_processing.overrides']).toEqual({
        paddleocr: {
          apiKeys: ['paddle-token']
        }
      })
      expect(result['feature.file_processing.default_text_extraction_processor']).toBe('paddleocr')
    })
  })
})
