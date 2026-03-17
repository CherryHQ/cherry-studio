import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { type JsonSchemaLike, jsonSchemaToZod } from '../../adapters/converters/json-schema-to-zod'

describe('jsonSchemaToZod', () => {
  describe('Basic Types', () => {
    it('should convert string type', () => {
      const schema: JsonSchemaLike = { type: 'string' }
      const result = jsonSchemaToZod(schema)
      expect(result).toBeInstanceOf(z.ZodString)
      expect(result.safeParse('hello').success).toBe(true)
      expect(result.safeParse(123).success).toBe(false)
    })

    it('should convert string with minLength', () => {
      const schema: JsonSchemaLike = { type: 'string', minLength: 3 }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('ab').success).toBe(false)
      expect(result.safeParse('abc').success).toBe(true)
    })

    it('should convert string with maxLength', () => {
      const schema: JsonSchemaLike = { type: 'string', maxLength: 5 }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('hello').success).toBe(true)
      expect(result.safeParse('hello world').success).toBe(false)
    })

    it('should convert string with pattern', () => {
      const schema: JsonSchemaLike = { type: 'string', pattern: '^[0-9]+$' }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('123').success).toBe(true)
      expect(result.safeParse('abc').success).toBe(false)
    })

    it('should convert number type', () => {
      const schema: JsonSchemaLike = { type: 'number' }
      const result = jsonSchemaToZod(schema)
      expect(result).toBeInstanceOf(z.ZodNumber)
      expect(result.safeParse(42).success).toBe(true)
      expect(result.safeParse(3.14).success).toBe(true)
      expect(result.safeParse('42').success).toBe(false)
    })

    it('should convert integer type', () => {
      const schema: JsonSchemaLike = { type: 'integer' }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse(42).success).toBe(true)
      expect(result.safeParse(3.14).success).toBe(false)
    })

    it('should convert number with minimum', () => {
      const schema: JsonSchemaLike = { type: 'number', minimum: 10 }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse(5).success).toBe(false)
      expect(result.safeParse(10).success).toBe(true)
      expect(result.safeParse(15).success).toBe(true)
    })

    it('should convert number with maximum', () => {
      const schema: JsonSchemaLike = { type: 'number', maximum: 100 }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse(50).success).toBe(true)
      expect(result.safeParse(100).success).toBe(true)
      expect(result.safeParse(150).success).toBe(false)
    })

    it('should convert boolean type', () => {
      const schema: JsonSchemaLike = { type: 'boolean' }
      const result = jsonSchemaToZod(schema)
      expect(result).toBeInstanceOf(z.ZodBoolean)
      expect(result.safeParse(true).success).toBe(true)
      expect(result.safeParse(false).success).toBe(true)
      expect(result.safeParse('true').success).toBe(false)
    })

    it('should convert null type', () => {
      const schema: JsonSchemaLike = { type: 'null' }
      const result = jsonSchemaToZod(schema)
      expect(result).toBeInstanceOf(z.ZodNull)
      expect(result.safeParse(null).success).toBe(true)
      expect(result.safeParse(undefined).success).toBe(false)
    })
  })

  describe('Enum Types', () => {
    it('should convert string enum', () => {
      const schema: JsonSchemaLike = { enum: ['red', 'green', 'blue'] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('red').success).toBe(true)
      expect(result.safeParse('green').success).toBe(true)
      expect(result.safeParse('yellow').success).toBe(false)
    })

    it('should convert non-string enum with literals', () => {
      const schema: JsonSchemaLike = { enum: [1, 2, 3] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse(1).success).toBe(true)
      expect(result.safeParse(2).success).toBe(true)
      expect(result.safeParse(4).success).toBe(false)
    })

    it('should convert single value enum', () => {
      const schema: JsonSchemaLike = { enum: ['only'] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('only').success).toBe(true)
      expect(result.safeParse('other').success).toBe(false)
    })

    it('should convert mixed enum', () => {
      const schema: JsonSchemaLike = { enum: ['text', 1, true] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('text').success).toBe(true)
      expect(result.safeParse(1).success).toBe(true)
      expect(result.safeParse(true).success).toBe(true)
      expect(result.safeParse(false).success).toBe(false)
    })
  })

  describe('Array Types', () => {
    it('should convert array of strings', () => {
      const schema: JsonSchemaLike = {
        type: 'array',
        items: { type: 'string' }
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse(['a', 'b']).success).toBe(true)
      expect(result.safeParse([1, 2]).success).toBe(false)
    })

    it('should convert array without items (unknown)', () => {
      const schema: JsonSchemaLike = { type: 'array' }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse([]).success).toBe(true)
      expect(result.safeParse(['a', 1, true]).success).toBe(true)
    })

    it('should convert array with minItems', () => {
      const schema: JsonSchemaLike = {
        type: 'array',
        items: { type: 'number' },
        minItems: 2
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse([1]).success).toBe(false)
      expect(result.safeParse([1, 2]).success).toBe(true)
    })

    it('should convert array with maxItems', () => {
      const schema: JsonSchemaLike = {
        type: 'array',
        items: { type: 'number' },
        maxItems: 3
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse([1, 2, 3]).success).toBe(true)
      expect(result.safeParse([1, 2, 3, 4]).success).toBe(false)
    })
  })

  describe('Object Types', () => {
    it('should convert simple object', () => {
      const schema: JsonSchemaLike = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        }
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse({ name: 'John', age: 30 }).success).toBe(true)
      expect(result.safeParse({ name: 'John', age: '30' }).success).toBe(false)
    })

    it('should handle required fields', () => {
      const schema: JsonSchemaLike = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name']
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse({ name: 'John', age: 30 }).success).toBe(true)
      expect(result.safeParse({ age: 30 }).success).toBe(false)
      expect(result.safeParse({ name: 'John' }).success).toBe(true)
    })

    it('should convert empty object', () => {
      const schema: JsonSchemaLike = { type: 'object' }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse({}).success).toBe(true)
    })

    it('should convert nested objects', () => {
      const schema: JsonSchemaLike = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' }
            }
          }
        }
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse({ user: { name: 'John', email: 'john@example.com' } }).success).toBe(true)
      expect(result.safeParse({ user: { name: 'John' } }).success).toBe(true)
    })
  })

  describe('Union Types', () => {
    it('should convert union type (type array)', () => {
      const schema: JsonSchemaLike = { type: ['string', 'null'] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('hello').success).toBe(true)
      expect(result.safeParse(null).success).toBe(true)
      expect(result.safeParse(123).success).toBe(false)
    })

    it('should convert single type array', () => {
      const schema: JsonSchemaLike = { type: ['string'] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('hello').success).toBe(true)
      expect(result.safeParse(123).success).toBe(false)
    })

    it('should convert multiple union types', () => {
      const schema: JsonSchemaLike = { type: ['string', 'number', 'boolean'] }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('text').success).toBe(true)
      expect(result.safeParse(42).success).toBe(true)
      expect(result.safeParse(true).success).toBe(true)
      expect(result.safeParse(null).success).toBe(false)
    })
  })

  describe('Description Handling', () => {
    it('should preserve description for string', () => {
      const schema: JsonSchemaLike = {
        type: 'string',
        description: 'A user name'
      }
      const result = jsonSchemaToZod(schema)
      expect(result.description).toBe('A user name')
    })

    it('should preserve description for enum', () => {
      const schema: JsonSchemaLike = {
        enum: ['red', 'green', 'blue'],
        description: 'Available colors'
      }
      const result = jsonSchemaToZod(schema)
      expect(result.description).toBe('Available colors')
    })

    it('should preserve description for object', () => {
      const schema: JsonSchemaLike = {
        type: 'object',
        description: 'User object',
        properties: {
          name: { type: 'string' }
        }
      }
      const result = jsonSchemaToZod(schema)
      expect(result.description).toBe('User object')
    })
  })

  describe('Edge Cases', () => {
    it('should handle unknown type', () => {
      const schema: JsonSchemaLike = { type: 'unknown-type' as any }
      const result = jsonSchemaToZod(schema)
      expect(result).toBeInstanceOf(z.ZodType)
      expect(result.safeParse(anything).success).toBe(true)
    })

    it('should handle schema without type', () => {
      const schema: JsonSchemaLike = {}
      const result = jsonSchemaToZod(schema)
      expect(result).toBeInstanceOf(z.ZodType)
      expect(result.safeParse(anything).success).toBe(true)
    })

    it('should handle complex nested schema', () => {
      const schema: JsonSchemaLike = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['id']
            }
          }
        }
      }
      const result = jsonSchemaToZod(schema)
      const validData = {
        items: [
          { id: 1, name: 'Item 1', tags: ['tag1', 'tag2'] },
          { id: 2, tags: [] }
        ]
      }
      expect(result.safeParse(validData).success).toBe(true)

      const invalidData = {
        items: [{ name: 'No ID' }]
      }
      expect(result.safeParse(invalidData).success).toBe(false)
    })
  })

  describe('OpenRouter Model IDs', () => {
    it('should handle model identifier format with colons', () => {
      const schema: JsonSchemaLike = {
        type: 'string',
        enum: ['openrouter:anthropic/claude-3.5-sonnet:free', 'openrouter:gpt-4:paid']
      }
      const result = jsonSchemaToZod(schema)
      expect(result.safeParse('openrouter:anthropic/claude-3.5-sonnet:free').success).toBe(true)
      expect(result.safeParse('openrouter:gpt-4:paid').success).toBe(true)
      expect(result.safeParse('other').success).toBe(false)
    })
  })
})

const anything = Math.random() > 0.5 ? 'string' : Math.random() > 0.5 ? 123 : { a: true }
