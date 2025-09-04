import { describe, expect, it, vi } from 'vitest'

import { formatErrorMessage, getErrorDetails, isAbortError } from '../error'

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
    it('should format error with indentation and header', () => {
      console.error = vi.fn()

      const error = new Error('Test error')
      const result = formatErrorMessage(error)

      expect(result).toContain('Error Details:')
      expect(result).toContain('  {')
      expect(result).toContain('    "message": "Test error"')
      expect(result).toContain('  }')
      expect(result).not.toContain('"stack":')
    })

    it('should remove sensitive information and format with proper indentation', () => {
      console.error = vi.fn()

      const error = {
        message: 'API error',
        headers: { Authorization: 'Bearer token' },
        stack: 'Error stack trace',
        request_id: '12345'
      }

      const result = formatErrorMessage(error)

      expect(result).toContain('Error Details:')
      expect(result).toContain('  {')
      expect(result).toContain('    "message": "API error"')
      expect(result).toContain('  }')
      expect(result).not.toContain('Authorization')
      expect(result).not.toContain('stack')
      expect(result).not.toContain('request_id')
    })

    it('should handle errors during formatting with simple error message', () => {
      console.error = vi.fn()

      const problematicError = {
        get message() {
          throw new Error('Cannot access')
        }
      }

      const result = formatErrorMessage(problematicError)
      expect(result).toContain('Error Details:')
      expect(result).toContain('"message": "<Unable to access property>"')
    })

    it('should handle non-serializable errors with simple error message', () => {
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
      expect(result).toContain('Error Details:')
      expect(result).toContain('"toString": "<Unable to access property>"')
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
