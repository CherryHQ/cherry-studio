import { describe, expect, it } from 'vitest'

import { getDuplicateModelNames, isFreeModel } from '../model'

describe('model', () => {
  describe('isFreeModel', () => {
    const base = { provider: '', group: '' }
    it('should return true if id or name contains "free" (case-insensitive)', () => {
      expect(isFreeModel({ id: 'free-model', name: 'test', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'FreePlan', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'notfree', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'test', ...base })).toBe(false)
    })

    it('should handle empty id or name', () => {
      expect(isFreeModel({ id: '', name: 'free', ...base })).toBe(true)
      expect(isFreeModel({ id: 'free', name: '', ...base })).toBe(true)
      expect(isFreeModel({ id: '', name: '', ...base })).toBe(false)
    })
  })

  describe('getDuplicateModelNames', () => {
    it('should return an empty Set for an empty array', () => {
      expect(getDuplicateModelNames([])).toStrictEqual(new Set())
    })

    it('should return an empty Set when no model names are duplicated', () => {
      expect(getDuplicateModelNames([{ name: 'gpt-4o' }, { name: 'claude-3-7-sonnet' }])).toStrictEqual(new Set())
    })

    it('should return the duplicated model names', () => {
      expect(
        getDuplicateModelNames([{ name: 'gpt-4o' }, { name: 'claude-3-7-sonnet' }, { name: 'gpt-4o' }])
      ).toStrictEqual(new Set(['gpt-4o']))
    })

    it('should return all names when every name appears more than once', () => {
      expect(
        getDuplicateModelNames([
          { name: 'gpt-4o' },
          { name: 'gpt-4o' },
          { name: 'claude-3-7-sonnet' },
          { name: 'claude-3-7-sonnet' }
        ])
      ).toStrictEqual(new Set(['gpt-4o', 'claude-3-7-sonnet']))
    })
  })
})
