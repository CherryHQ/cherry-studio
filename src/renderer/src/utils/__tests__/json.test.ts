import { describe, expect, it } from 'vitest'

import { isJSON, parseJSON, parseJsonRecursive } from '../index'

describe('json', () => {
  describe('isJSON', () => {
    it('should return true for valid JSON string', () => {
      // 验证有效 JSON 字符串
      expect(isJSON('{"key": "value"}')).toBe(true)
    })

    it('should return false for empty string', () => {
      // 验证空字符串
      expect(isJSON('')).toBe(false)
    })

    it('should return false for invalid JSON string', () => {
      // 验证无效 JSON 字符串
      expect(isJSON('{invalid json}')).toBe(false)
    })

    it('should return false for non-string input', () => {
      // 验证非字符串输入
      expect(isJSON(123)).toBe(false)
      expect(isJSON({})).toBe(false)
      expect(isJSON(null)).toBe(false)
      expect(isJSON(undefined)).toBe(false)
    })
  })

  describe('parseJSON', () => {
    it('should parse valid JSON string to object', () => {
      // 验证有效 JSON 字符串解析
      const result = parseJSON('{"key": "value"}')
      expect(result).toEqual({ key: 'value' })
    })

    it('should return null for invalid JSON string', () => {
      // 验证无效 JSON 字符串返回 null
      const result = parseJSON('{invalid json}')
      expect(result).toBe(null)
    })
  })

  describe('parseJsonRecursive', () => {
    it('should parse valid JSON string to object', () => {
      const result = parseJsonRecursive('{"name": "John", "age": 30}')
      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('should return null for invalid JSON string', () => {
      const result = parseJsonRecursive('{invalid json}')
      expect(result).toBeNull()
    })

    it('should recursively parse nested JSON strings in object values', () => {
      const input = '{"data": "{\\"message\\": \\"hello\\"}"}'
      const result = parseJsonRecursive(input)
      expect(result).toEqual({ data: { message: 'hello' } })
    })

    it('should recursively parse nested JSON strings in array elements', () => {
      const input = '["{\\"value\\": 42}", "[1,2,3]"]'
      const result = parseJsonRecursive(input)
      expect(result).toEqual([{ value: 42 }, [1, 2, 3]])
    })

    it('should handle deeply nested JSON strings', () => {
      const input = '{"level1": "{\\"level2\\": \\"{\\\\\\"level3\\\\\\": \\\\\\"deep\\\\\\"}\\"}"}'
      const result = parseJsonRecursive(input)
      expect(result).toEqual({ level1: { level2: { level3: 'deep' } } })
    })

    it('should not modify non-JSON strings', () => {
      const input = '{"text": "this is not json", "number": 123}'
      const result = parseJsonRecursive(input)
      expect(result).toEqual({ text: 'this is not json', number: 123 })
    })

    it('should handle arrays with mixed JSON and non-JSON strings', () => {
      const input = '["{\\"a\\":1}", "not json", "{\\"b\\":2}"]'
      const result = parseJsonRecursive(input)
      expect(result).toEqual([{ a: 1 }, 'not json', { b: 2 }])
    })

    it('should handle primitive values', () => {
      expect(parseJsonRecursive('42')).toBe(42)
      expect(parseJsonRecursive('true')).toBe(true)
      expect(parseJsonRecursive('"string"')).toBe('string')
    })

    it('should return null when parsing throws an error', () => {
      const result = parseJsonRecursive(undefined as unknown as string)
      expect(result).toBeNull()
    })

    it('should handle empty string and empty object', () => {
      expect(parseJsonRecursive('""')).toBe('')
      expect(parseJsonRecursive('{}')).toEqual({})
      expect(parseJsonRecursive('[]')).toEqual([])
    })

    it('should handle JSON strings with escaped quotes', () => {
      const input = '{"message": "{\\"content\\": \\"hello \\\\\\"world\\\\\\"\\"}"}'
      const result = parseJsonRecursive(input)
      expect(result).toEqual({ message: { content: 'hello "world"' } })
    })
  })
})
