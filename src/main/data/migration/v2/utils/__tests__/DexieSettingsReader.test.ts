import { describe, expect, it } from 'vitest'

import { DexieSettingsReader, type DexieSettingsRecord } from '../DexieSettingsReader'

describe('DexieSettingsReader', () => {
  const sampleRecords: DexieSettingsRecord[] = [
    { id: 'translate:markdown:enabled', value: true },
    { id: 'translate:markdown:theme', value: 'github' },
    { id: 'pinned:models', value: 'model-a,model-b' },
    { id: 'translate:model', value: null }
  ]

  describe('constructor', () => {
    it('should initialize with empty records', () => {
      const reader = new DexieSettingsReader([])
      expect(reader.size).toBe(0)
    })

    it('should initialize with populated records', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.size).toBe(4)
    })

    it('should handle duplicate ids by keeping the last one', () => {
      const records: DexieSettingsRecord[] = [
        { id: 'key', value: 'first' },
        { id: 'key', value: 'second' }
      ]
      const reader = new DexieSettingsReader(records)
      expect(reader.size).toBe(1)
      expect(reader.get('key')).toBe('second')
    })
  })

  describe('get', () => {
    it('should return value for existing key', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.get('translate:markdown:enabled')).toBe(true)
      expect(reader.get('translate:markdown:theme')).toBe('github')
    })

    it('should return undefined for non-existing key', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.get('non:existent')).toBeUndefined()
    })

    it('should return null when stored value is null', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.get('translate:model')).toBeNull()
    })

    it('should support generic type parameter', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      const value = reader.get<boolean>('translate:markdown:enabled')
      expect(value).toBe(true)
    })
  })

  describe('has', () => {
    it('should return true for existing key', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.has('pinned:models')).toBe(true)
    })

    it('should return false for non-existing key', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.has('non:existent')).toBe(false)
    })

    it('should return true even when value is null', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.has('translate:model')).toBe(true)
    })
  })

  describe('keys', () => {
    it('should return empty array for empty reader', () => {
      const reader = new DexieSettingsReader([])
      expect(reader.keys()).toEqual([])
    })

    it('should return all keys', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      const keys = reader.keys()
      expect(keys).toHaveLength(4)
      expect(keys).toContain('translate:markdown:enabled')
      expect(keys).toContain('translate:markdown:theme')
      expect(keys).toContain('pinned:models')
      expect(keys).toContain('translate:model')
    })

    it('should return a new array each time (not internal reference)', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      const keys1 = reader.keys()
      const keys2 = reader.keys()
      expect(keys1).not.toBe(keys2)
      expect(keys1).toEqual(keys2)
    })
  })

  describe('size', () => {
    it('should return 0 for empty reader', () => {
      const reader = new DexieSettingsReader([])
      expect(reader.size).toBe(0)
    })

    it('should return correct count', () => {
      const reader = new DexieSettingsReader(sampleRecords)
      expect(reader.size).toBe(4)
    })
  })
})
