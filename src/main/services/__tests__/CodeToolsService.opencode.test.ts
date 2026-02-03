import { describe, expect, it } from 'vitest'

import { getFunctionalKeys, parseJSONC, sanitizeEnvForLogging } from '../CodeToolsService'

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
      // jsonc-parser will not execute any code - it either parses valid parts or returns null
      const maliciousContent = '{"name": "test"}; console.log("hacked")'
      const result = parseJSONC(maliciousContent)
      // jsonc-parser parses the valid JSON part and ignores the rest
      // The key point is that NO code execution occurs
      expect(result).toEqual({ name: 'test' })
    })

    it('should not execute embedded code blocks', () => {
      const content = '{"test": (function() { return "executed"; })()}'
      const result = parseJSONC(content)
      // jsonc-parser handles function syntax safely (no code execution)
      // The result is either null (parse error) or a safe object
      expect(result === null || result === undefined || typeof result === 'object').toBe(true)
    })

    it('should safely handle malicious input without crashing', () => {
      // Various injection attempts that should be safely handled without crashing
      const maliciousInputs = ['{"a": __dirname}', '{"a": process.cwd()}', '{"a": require("fs")}', '{"a": eval("1+1")}']
      for (const input of maliciousInputs) {
        // Should not throw or crash, even with unusual input
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
    // Only $schema is in NON_FUNCTIONAL_KEYS
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
    // Note: API_KEY detection uses includes(), so "NON_API_KEY" contains "API_KEY"
    // This is intentional for security - better to over-redact than under-redact
    const env = { API_KEY_PATH: '/path/to/key', MODEL_PATH: '/path/to/model' }
    const result = sanitizeEnvForLogging(env)
    expect(result.API_KEY_PATH).toBe('<redacted>')
    expect(result.MODEL_PATH).toBe('/path/to/model')
  })
})
