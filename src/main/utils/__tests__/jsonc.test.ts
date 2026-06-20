import { describe, expect, it } from 'vitest'

import { getFunctionalKeys, parseJSONC } from '../jsonc'

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
