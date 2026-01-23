import { describe, expect, it } from 'vitest'

import { mergeHeaders } from '../headers'

describe('mergeHeaders', () => {
  describe('basic merging', () => {
    it('should merge multiple header objects', () => {
      const result = mergeHeaders({ 'X-Custom': 'value1' }, { 'X-Other': 'value2' })

      expect(result['x-custom']).toBe('value1')
      expect(result['x-other']).toBe('value2')
    })

    it('should override headers with same key (case-insensitive)', () => {
      const result = mergeHeaders({ 'X-Custom': 'value1' }, { 'x-custom': 'value2' })

      expect(result['x-custom']).toBe('value2')
    })

    it('should normalize all keys to lowercase', () => {
      const result = mergeHeaders({ 'X-Custom': 'value1', 'Content-Type': 'application/json' })

      expect(Object.keys(result)).toEqual(expect.arrayContaining(['x-custom', 'content-type']))
      expect(result['x-custom']).toBe('value1')
      expect(result['content-type']).toBe('application/json')
    })

    it('should skip undefined and null header sets', () => {
      const result = mergeHeaders({ 'X-Custom': 'value1' }, undefined, null as any, { 'X-Other': 'value2' })

      expect(result['x-custom']).toBe('value1')
      expect(result['x-other']).toBe('value2')
    })

    it('should skip undefined values in headers', () => {
      const result = mergeHeaders({ 'X-Custom': 'value1', 'X-Undefined': undefined })

      expect(result['x-custom']).toBe('value1')
      expect(result['x-undefined']).toBeUndefined()
    })
  })

  describe('User-Agent special handling', () => {
    it('should concatenate User-Agent values with space', () => {
      const result = mergeHeaders({ 'User-Agent': 'DefaultAgent' }, { 'user-agent': 'CustomSuffix' })

      expect(result['user-agent']).toBe('DefaultAgent CustomSuffix')
    })

    it('should concatenate multiple User-Agent values in order', () => {
      const result = mergeHeaders({ 'User-Agent': 'Agent1' }, { 'user-agent': 'Agent2' }, { 'USER-AGENT': 'Agent3' })

      expect(result['user-agent']).toBe('Agent1 Agent2 Agent3')
    })

    it('should handle User-Agent with mixed case keys', () => {
      const result = mergeHeaders({ 'USER-AGENT': 'DefaultAgent' }, { 'User-Agent': 'CustomSuffix' })

      expect(result['user-agent']).toBe('DefaultAgent CustomSuffix')
    })

    it('should handle single User-Agent', () => {
      const result = mergeHeaders({ 'User-Agent': 'SingleAgent' })

      expect(result['user-agent']).toBe('SingleAgent')
    })

    it('should handle no User-Agent', () => {
      const result = mergeHeaders({ 'X-Custom': 'value' })

      expect(result['user-agent']).toBeUndefined()
    })
  })

  describe('example from documentation', () => {
    it('should match the documented example', () => {
      const result = mergeHeaders(
        { 'User-Agent': 'DefaultAgent', 'X-Custom': 'value1' },
        { 'user-agent': 'CustomSuffix', 'X-Custom': 'value2' }
      )

      expect(result['user-agent']).toBe('DefaultAgent CustomSuffix')
      expect(result['x-custom']).toBe('value2')
    })
  })

  describe('edge cases', () => {
    it('should return empty object when no headers provided', () => {
      const result = mergeHeaders()

      expect(result).toEqual({})
    })

    it('should handle empty header objects', () => {
      const result = mergeHeaders({}, { 'X-Custom': 'value' }, {})

      expect(result['x-custom']).toBe('value')
    })

    it('should handle HeadersInit types', () => {
      const headersInit = new Headers({ 'X-Custom': 'value1' })
      const result = mergeHeaders(headersInit, { 'X-Other': 'value2' })

      expect(result['x-custom']).toBe('value1')
      expect(result['x-other']).toBe('value2')
    })
  })
})
