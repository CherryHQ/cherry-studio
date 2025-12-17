import { beforeEach, describe, expect, it, vi } from 'vitest'

import remarkDisableConstructs from '../remarkDisableConstructs'

describe('remarkDisableConstructs', () => {
  let mockData: any
  let mockThis: any

  beforeEach(() => {
    mockData = {}
    mockThis = {
      data: vi.fn().mockReturnValue(mockData)
    }
  })

  describe('plugin creation', () => {
    it('should return a function when called', () => {
      const plugin = remarkDisableConstructs(['codeIndented'])

      expect(typeof plugin).toBe('function')
    })
  })

  describe('normal path', () => {
    it('should add micromarkExtensions for single construct', () => {
      const plugin = remarkDisableConstructs(['codeIndented'])
      plugin.call(mockThis as any)

      expect(mockData).toHaveProperty('micromarkExtensions')
      expect(Array.isArray(mockData.micromarkExtensions)).toBe(true)
      expect(mockData.micromarkExtensions).toHaveLength(1)
      expect(mockData.micromarkExtensions[0]).toEqual({
        disable: {
          null: ['codeIndented']
        }
      })
    })

    it('should handle multiple constructs', () => {
      const constructs = ['codeIndented', 'autolink', 'htmlFlow']
      const plugin = remarkDisableConstructs(constructs)
      plugin.call(mockThis as any)

      expect(mockData.micromarkExtensions[0]).toEqual({
        disable: {
          null: constructs
        }
      })
    })
  })

  describe('edge cases', () => {
    it('should not add extensions when empty array is provided', () => {
      const plugin = remarkDisableConstructs([])
      plugin.call(mockThis as any)

      expect(mockData).not.toHaveProperty('micromarkExtensions')
    })

    it('should not add extensions when undefined is passed', () => {
      const plugin = remarkDisableConstructs()
      plugin.call(mockThis as any)

      expect(mockData).not.toHaveProperty('micromarkExtensions')
    })

    it('should handle empty construct names', () => {
      const plugin = remarkDisableConstructs(['', ' '])
      plugin.call(mockThis as any)

      expect(mockData.micromarkExtensions[0]).toEqual({
        disable: {
          null: ['', ' ']
        }
      })
    })

    it('should handle mixed valid and empty construct names', () => {
      const plugin = remarkDisableConstructs(['codeIndented', '', 'autolink'])
      plugin.call(mockThis as any)

      expect(mockData.micromarkExtensions[0]).toEqual({
        disable: {
          null: ['codeIndented', '', 'autolink']
        }
      })
    })
  })

  describe('interaction with existing data', () => {
    it('should append to existing micromarkExtensions', () => {
      const existingExtension = { some: 'extension' }
      mockData.micromarkExtensions = [existingExtension]

      const plugin = remarkDisableConstructs(['codeIndented'])
      plugin.call(mockThis as any)

      expect(mockData.micromarkExtensions).toHaveLength(2)
      expect(mockData.micromarkExtensions[0]).toBe(existingExtension)
      expect(mockData.micromarkExtensions[1]).toEqual({
        disable: {
          null: ['codeIndented']
        }
      })
    })
  })
})
