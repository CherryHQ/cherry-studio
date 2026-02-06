import { describe, expect, it } from 'vitest'

import {
  getFunctionalKeys,
  isBase64ImageDataUrl,
  isDataUrl,
  parseDataUrl,
  parseJSONC,
  sanitizeEnvForLogging
} from '../utils'

describe('parseDataUrl', () => {
  it('parses a standard base64 image data URL', () => {
    const result = parseDataUrl('data:image/png;base64,iVBORw0KGgo=')
    expect(result).toEqual({
      mediaType: 'image/png',
      isBase64: true,
      data: 'iVBORw0KGgo='
    })
  })

  it('parses a base64 data URL with additional parameters', () => {
    const result = parseDataUrl('data:image/jpeg;name=foo;base64,/9j/4AAQ')
    expect(result).toEqual({
      mediaType: 'image/jpeg',
      isBase64: true,
      data: '/9j/4AAQ'
    })
  })

  it('parses a plain text data URL (non-base64)', () => {
    const result = parseDataUrl('data:text/plain,Hello%20World')
    expect(result).toEqual({
      mediaType: 'text/plain',
      isBase64: false,
      data: 'Hello%20World'
    })
  })

  it('parses a data URL with empty media type', () => {
    const result = parseDataUrl('data:;base64,SGVsbG8=')
    expect(result).toEqual({
      mediaType: undefined,
      isBase64: true,
      data: 'SGVsbG8='
    })
  })

  it('returns null for non-data URLs', () => {
    const result = parseDataUrl('https://example.com/image.png')
    expect(result).toBeNull()
  })

  it('returns null for malformed data URL without comma', () => {
    const result = parseDataUrl('data:image/png;base64')
    expect(result).toBeNull()
  })

  it('handles empty string', () => {
    const result = parseDataUrl('')
    expect(result).toBeNull()
  })

  it('handles large base64 data without performance issues', () => {
    // Simulate a 4K image base64 string (about 1MB)
    const largeData = 'A'.repeat(1024 * 1024)
    const dataUrl = `data:image/png;base64,${largeData}`

    const start = performance.now()
    const result = parseDataUrl(dataUrl)
    const duration = performance.now() - start

    expect(result).not.toBeNull()
    expect(result?.mediaType).toBe('image/png')
    expect(result?.isBase64).toBe(true)
    expect(result?.data).toBe(largeData)
    // Should complete in under 10ms (string operations are fast)
    expect(duration).toBeLessThan(10)
  })

  it('parses SVG data URL', () => {
    const result = parseDataUrl('data:image/svg+xml;base64,PHN2Zz4=')
    expect(result).toEqual({
      mediaType: 'image/svg+xml',
      isBase64: true,
      data: 'PHN2Zz4='
    })
  })

  it('parses JSON data URL', () => {
    const result = parseDataUrl('data:application/json,{"key":"value"}')
    expect(result).toEqual({
      mediaType: 'application/json',
      isBase64: false,
      data: '{"key":"value"}'
    })
  })
})

describe('isDataUrl', () => {
  it('returns true for valid data URLs', () => {
    expect(isDataUrl('data:image/png;base64,ABC')).toBe(true)
    expect(isDataUrl('data:text/plain,hello')).toBe(true)
    expect(isDataUrl('data:,simple')).toBe(true)
  })

  it('returns false for non-data URLs', () => {
    expect(isDataUrl('https://example.com')).toBe(false)
    expect(isDataUrl('file:///path/to/file')).toBe(false)
    expect(isDataUrl('')).toBe(false)
  })

  it('returns false for malformed data URLs', () => {
    expect(isDataUrl('data:')).toBe(false)
    expect(isDataUrl('data:image/png')).toBe(false)
  })
})

describe('isBase64ImageDataUrl', () => {
  it('returns true for base64 image data URLs', () => {
    expect(isBase64ImageDataUrl('data:image/png;base64,ABC')).toBe(true)
    expect(isBase64ImageDataUrl('data:image/jpeg;base64,/9j/')).toBe(true)
    expect(isBase64ImageDataUrl('data:image/gif;base64,R0lG')).toBe(true)
    expect(isBase64ImageDataUrl('data:image/webp;base64,UklG')).toBe(true)
  })

  it('returns false for non-base64 image data URLs', () => {
    expect(isBase64ImageDataUrl('data:image/svg+xml,<svg></svg>')).toBe(false)
  })

  it('returns false for non-image data URLs', () => {
    expect(isBase64ImageDataUrl('data:text/plain;base64,SGVsbG8=')).toBe(false)
    expect(isBase64ImageDataUrl('data:application/json,{}')).toBe(false)
  })

  it('returns false for regular URLs', () => {
    expect(isBase64ImageDataUrl('https://example.com/image.png')).toBe(false)
    expect(isBase64ImageDataUrl('file:///image.png')).toBe(false)
  })

  it('returns false for malformed data URLs', () => {
    expect(isBase64ImageDataUrl('data:image/png')).toBe(false)
    expect(isBase64ImageDataUrl('')).toBe(false)
  })
})

describe('parseJSONC - JSON with Comments Parser', () => {
  describe('Standard JSON parsing', () => {
    it('should parse standard JSON without comments', () => {
      const content = '{"name": "test", "value": 123}'
      const result = parseJSONC(content)
      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should parse nested JSON objects', () => {
      const content = '{"provider": {"name": "cherry", "npm": "@ai-sdk/openai"}}'
      const result = parseJSONC(content)
      expect(result).toEqual({ provider: { name: 'cherry', npm: '@ai-sdk/openai' } })
    })

    it('should parse JSON arrays', () => {
      const content = '{"models": ["model1", "model2"]}'
      const result = parseJSONC(content)
      expect(result).toEqual({ models: ['model1', 'model2'] })
    })

    it('should parse empty object', () => {
      const content = '{}'
      const result = parseJSONC(content)
      expect(result).toEqual({})
    })
  })

  describe('JSON with comments', () => {
    it('should parse JSON with single-line comments', () => {
      const content = `{
        "name": "test",
        // This is a comment
        "value": 123
      }`
      const result = parseJSONC(content)
      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should parse JSON with multi-line comments', () => {
      const content = `{
        "name": "test",
        /* This is a
           multi-line comment */
        "value": 123
      }`
      const result = parseJSONC(content)
      expect(result).toEqual({ name: 'test', value: 123 })
    })
  })

  describe('JSON with trailing commas', () => {
    it('should parse JSON with trailing comma in object', () => {
      const content = `{
        "name": "test",
        "value": 123,
      }`
      const result = parseJSONC(content)
      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should parse JSON with trailing comma in array', () => {
      const content = '["a", "b", "c",]'
      const result = parseJSONC(content)
      expect(result).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Invalid JSON handling', () => {
    it('should return null for completely invalid content', () => {
      const content = 'not json at all'
      const result = parseJSONC(content)
      expect(result).toBeNull()
    })

    it('should return null for empty string', () => {
      const content = ''
      const result = parseJSONC(content)
      expect(result).toBeNull()
    })
  })

  describe('Code injection protection', () => {
    it('should safely parse JSON without executing code', () => {
      const maliciousContent = '{"name": "test"}; console.log("hacked")'
      const result = parseJSONC(maliciousContent)
      expect(result).toEqual({ name: 'test' })
    })

    it('should safely handle malicious input without crashing', () => {
      const maliciousInputs = ['{"a": __dirname}', '{"a": process.cwd()}', '{"a": require("fs")}', '{"a": eval("1+1")}']
      for (const input of maliciousInputs) {
        expect(() => parseJSONC(input)).not.toThrow()
      }
    })
  })
})

describe('getFunctionalKeys - Filter Non-Functional Keys', () => {
  it('should filter out $schema key', () => {
    const obj = {
      $schema: 'https://opencode.ai/config.json',
      provider: { 'Cherry-Studio': { name: 'test' } },
      model: 'test-model'
    }
    const result = getFunctionalKeys(obj)
    expect(result).toEqual(['provider', 'model'])
    expect(result).not.toContain('$schema')
  })

  it('should handle empty object', () => {
    const obj = {}
    const result = getFunctionalKeys(obj)
    expect(result).toEqual([])
  })

  it('should return all keys when no non-functional keys present', () => {
    const obj = { provider: {}, model: 'test' }
    const result = getFunctionalKeys(obj)
    expect(result).toEqual(['provider', 'model'])
  })

  it('should filter multiple non-functional keys if defined', () => {
    const obj = {
      $schema: 'https://opencode.ai/config.json',
      $id: 'some-id',
      provider: { test: {} }
    }
    const result = getFunctionalKeys(obj)
    expect(result).toEqual(['$id', 'provider'])
  })
})

describe('sanitizeEnvForLogging - Sensitive Data Redaction', () => {
  it('should redact API_KEY values', () => {
    const env = { OPENAI_API_KEY: 'sk-secret123', MODEL: 'gpt-4' }
    const result = sanitizeEnvForLogging(env)
    expect(result.OPENAI_API_KEY).toBe('<redacted>')
    expect(result.MODEL).toBe('gpt-4')
  })

  it('should redact AUTHORIZATION tokens', () => {
    const env = { AUTHORIZATION: 'Bearer token123' }
    const result = sanitizeEnvForLogging(env)
    expect(result.AUTHORIZATION).toBe('<redacted>')
  })

  it('should redact TOKEN values', () => {
    const env = { GITHUB_TOKEN: 'ghp_12345' }
    const result = sanitizeEnvForLogging(env)
    expect(result.GITHUB_TOKEN).toBe('<redacted>')
  })

  it('should redact SECRET values', () => {
    const env = { AWS_SECRET_ACCESS_KEY: 'secret-key' }
    const result = sanitizeEnvForLogging(env)
    expect(result.AWS_SECRET_ACCESS_KEY).toBe('<redacted>')
  })

  it('should redact PASSWORD values', () => {
    const env = { DATABASE_PASSWORD: 'mypassword' }
    const result = sanitizeEnvForLogging(env)
    expect(result.DATABASE_PASSWORD).toBe('<redacted>')
  })

  it('should be case-insensitive for sensitive key detection', () => {
    const env = { api_key: 'lowercase', API_KEY: 'uppercase', Api_Key: 'mixed' }
    const result = sanitizeEnvForLogging(env)
    expect(result.api_key).toBe('<redacted>')
    expect(result.API_KEY).toBe('<redacted>')
    expect(result.Api_Key).toBe('<redacted>')
  })

  it('should handle empty environment object', () => {
    const env = {}
    const result = sanitizeEnvForLogging(env)
    expect(result).toEqual({})
  })

  it('should handle keys that partially contain sensitive words', () => {
    const env = { API_KEY_PATH: '/path/to/key', MODEL_PATH: '/path/to/model' }
    const result = sanitizeEnvForLogging(env)
    expect(result.API_KEY_PATH).toBe('<redacted>')
    expect(result.MODEL_PATH).toBe('/path/to/model')
  })
})
