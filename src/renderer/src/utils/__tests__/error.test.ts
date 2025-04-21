import { describe, expect, it, vi } from 'vitest'

import { formatErrorMessage, formatMessageError, getErrorDetails, getErrorMessage, isAbortError } from '../error'

describe('error', () => {
  describe('getErrorDetails', () => {
    it('should handle null or non-object values', () => {
      expect(getErrorDetails(null)).toBeNull()
      expect(getErrorDetails('string error')).toBe('string error')
      expect(getErrorDetails(123)).toBe(123)
    })

    it('should handle circular references', () => {
      const circularObj: any = {}
      circularObj.self = circularObj

      const result = getErrorDetails(circularObj)
      expect(result).toEqual({ self: circularObj })
    })

    it('should extract properties from Error objects', () => {
      const error = new Error('Test error')
      const result = getErrorDetails(error)

      expect(result.message).toBe('Test error')
      expect(result.stack).toBeDefined()
    })

    it('should skip function properties', () => {
      const objWithFunction = {
        prop: 'value',
        func: () => 'function'
      }

      const result = getErrorDetails(objWithFunction)
      expect(result.prop).toBe('value')
      expect(result.func).toBeUndefined()
    })

    it('should handle nested objects', () => {
      const nestedError = {
        message: 'Outer error',
        cause: new Error('Inner error')
      }

      const result = getErrorDetails(nestedError)
      expect(result.message).toBe('Outer error')
      expect(result.cause.message).toBe('Inner error')
    })
  })

  describe('formatErrorMessage', () => {
    it('should format error as JSON string', () => {
      console.error = vi.fn() // Mock console.error

      const error = new Error('Test error')
      const result = formatErrorMessage(error)

      expect(console.error).toHaveBeenCalled()
      expect(result).toContain('```json')
      expect(result).toContain('"message": "Test error"')
      expect(result).not.toContain('"stack":')
    })

    it('should remove sensitive information', () => {
      console.error = vi.fn()

      const error = {
        message: 'API error',
        headers: { Authorization: 'Bearer token' },
        stack: 'Error stack trace',
        request_id: '12345'
      }

      const result = formatErrorMessage(error)

      expect(result).toContain('"message": "API error"')
      expect(result).not.toContain('Authorization')
      expect(result).not.toContain('stack')
      expect(result).not.toContain('request_id')
    })

    it('should handle errors during formatting', () => {
      console.error = vi.fn()

      const problematicError = {
        get message() {
          throw new Error('Cannot access message')
        }
      }

      const result = formatErrorMessage(problematicError)
      expect(result).toContain('```')
      expect(result).toContain('Unable')
    })

    it('should handle non-serializable errors', () => {
      console.error = vi.fn()

      const nonSerializableError = {
        toString() {
          throw new Error('Cannot convert to string')
        }
      }

      try {
        Object.defineProperty(nonSerializableError, 'toString', {
          get() {
            throw new Error('Cannot access toString')
          }
        })
      } catch (e) {
        // Ignore
      }

      const result = formatErrorMessage(nonSerializableError)
      expect(result).toBeTruthy()
    })
  })

  describe('formatMessageError', () => {
    it('should return error details as an object', () => {
      const error = new Error('Test error')
      const result = formatMessageError(error)

      expect(result.message).toBe('Test error')
      expect(result.stack).toBeUndefined()
      expect(result.headers).toBeUndefined()
      expect(result.request_id).toBeUndefined()
    })

    it('should handle string errors', () => {
      const result = formatMessageError('String error')
      expect(typeof result).toBe('string')
      expect(result).toBe('String error')
    })

    it('should handle formatting errors', () => {
      const problematicError = {
        get message() {
          throw new Error('Cannot access')
        },
        toString: () => 'Error object'
      }

      const result = formatMessageError(problematicError)
      expect(result).toBeTruthy()
    })

    it('should handle completely invalid errors', () => {
      let invalidError: any
      try {
        invalidError = Object.create(null)
        Object.defineProperty(invalidError, 'toString', {
          get: () => {
            throw new Error()
          }
        })
      } catch (e) {
        invalidError = {
          toString() {
            throw new Error()
          }
        }
      }

      const result = formatMessageError(invalidError)
      expect(result).toBeTruthy()
    })
  })

  describe('getErrorMessage', () => {
    it('should extract message from Error objects', () => {
      const error = new Error('Test message')
      expect(getErrorMessage(error)).toBe('Test message')
    })

    it('should handle objects with message property', () => {
      const errorObj = { message: 'Object message' }
      expect(getErrorMessage(errorObj)).toBe('Object message')
    })

    it('should convert non-Error objects to string', () => {
      const obj = { toString: () => 'Custom toString' }
      expect(getErrorMessage(obj)).toBe('Custom toString')
    })

    it('should return empty string for undefined or null', () => {
      expect(getErrorMessage(undefined)).toBe('')
      expect(getErrorMessage(null)).toBe('')
    })
  })

  describe('isAbortError', () => {
    it('should identify OpenAI abort errors by message', () => {
      const openaiError = { message: 'Request was aborted.' }
      expect(isAbortError(openaiError)).toBe(true)
    })

    it('should identify DOM AbortError', () => {
      const domError = new DOMException('The operation was aborted', 'AbortError')
      expect(isAbortError(domError)).toBe(true)
    })

    it('should identify aborted signal errors', () => {
      const signalError = { message: 'The operation was aborted because signal is aborted without reason' }
      expect(isAbortError(signalError)).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isAbortError(new Error('Generic error'))).toBe(false)
      expect(isAbortError({ message: 'Not an abort error' })).toBe(false)
      expect(isAbortError('String error')).toBe(false)
      expect(isAbortError(null)).toBe(false)
    })
  })
})
