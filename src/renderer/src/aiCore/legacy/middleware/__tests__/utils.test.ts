import { ChunkType } from '@renderer/types/chunk'
import { describe, expect, it } from 'vitest'

import { capitalize, createErrorChunk, isAsyncIterable } from '../utils'

describe('utils', () => {
  describe('createErrorChunk', () => {
    it('should handle Error instances', () => {
      const error = new Error('Test error message')
      const result = createErrorChunk(error)

      expect(result.type).toBe(ChunkType.ERROR)
      expect(result.error.message).toBe('Test error message')
      expect(result.error.name).toBe('Error')
      expect(result.error.stack).toBeDefined()
    })

    it('should handle string errors', () => {
      const result = createErrorChunk('Something went wrong')
      expect(result.error).toEqual({ message: 'Something went wrong' })
    })

    it('should handle plain objects', () => {
      const error = { code: 'NETWORK_ERROR', status: 500 }
      const result = createErrorChunk(error)
      expect(result.error).toEqual(error)
    })

    it('should handle null and undefined', () => {
      expect(createErrorChunk(null).error).toEqual({})
      expect(createErrorChunk(undefined).error).toEqual({})
    })

    it('should use custom chunk type when provided', () => {
      const result = createErrorChunk('error', ChunkType.BLOCK_COMPLETE)
      expect(result.type).toBe(ChunkType.BLOCK_COMPLETE)
    })

    it('should use toString for objects without message', () => {
      const error = {
        toString: () => 'Custom error'
      }
      const result = createErrorChunk(error)
      expect(result.error.message).toBe('Custom error')
    })
  })

  describe('capitalize', () => {
    it('should capitalize first letter', () => {
      expect(capitalize('hello')).toBe('Hello')
      expect(capitalize('a')).toBe('A')
    })

    it('should handle edge cases', () => {
      expect(capitalize('')).toBe('')
      expect(capitalize('123')).toBe('123')
      expect(capitalize('Hello')).toBe('Hello')
    })
  })

  describe('isAsyncIterable', () => {
    it('should identify async iterables', () => {
      async function* gen() {
        yield 1
      }
      expect(isAsyncIterable(gen())).toBe(true)
      expect(isAsyncIterable({ [Symbol.asyncIterator]: () => {} })).toBe(true)
    })

    it('should reject non-async iterables', () => {
      expect(isAsyncIterable([1, 2, 3])).toBe(false)
      expect(isAsyncIterable(new Set())).toBe(false)
      expect(isAsyncIterable({})).toBe(false)
      expect(isAsyncIterable(null)).toBe(false)
      expect(isAsyncIterable(123)).toBe(false)
      expect(isAsyncIterable('string')).toBe(false)
    })
  })
})
