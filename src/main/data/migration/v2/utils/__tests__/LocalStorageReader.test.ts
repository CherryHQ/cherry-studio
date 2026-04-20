import type { LocalStorageRecord } from '@shared/data/migration/v2/types'
import { describe, expect, it } from 'vitest'

import { LocalStorageReader } from '../LocalStorageReader'

describe('LocalStorageReader', () => {
  const sampleRecords: LocalStorageRecord[] = [
    { key: 'privacy-popup-accepted', value: true },
    { key: 'provider:openai:token', value: 'sk-xxx' },
    { key: 'provider:anthropic:token', value: 'sk-ant-xxx' },
    { key: 'failed_favicon_example.com', value: 1700000000000 },
    { key: 'failed_favicon_test.org', value: 1700000000001 },
    { key: 'ui-state:sidebar-collapsed', value: false },
    { key: 'null-value-key', value: null }
  ]

  describe('constructor', () => {
    it('should initialize with empty records', () => {
      const reader = new LocalStorageReader([])
      expect(reader.size).toBe(0)
    })

    it('should initialize with populated records', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.size).toBe(7)
    })

    it('should handle duplicate keys by keeping the last one', () => {
      const records: LocalStorageRecord[] = [
        { key: 'dup', value: 'first' },
        { key: 'dup', value: 'second' }
      ]
      const reader = new LocalStorageReader(records)
      expect(reader.size).toBe(1)
      expect(reader.get('dup')).toBe('second')
    })
  })

  describe('get', () => {
    it('should return value for existing key', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.get('privacy-popup-accepted')).toBe(true)
    })

    it('should return undefined for non-existing key', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.get('non-existent')).toBeUndefined()
    })

    it('should return null when stored value is null', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.get('null-value-key')).toBeNull()
    })

    it('should support generic type parameter', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const value = reader.get<boolean>('privacy-popup-accepted')
      expect(value).toBe(true)
    })
  })

  describe('has', () => {
    it('should return true for existing key', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.has('privacy-popup-accepted')).toBe(true)
    })

    it('should return false for non-existing key', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.has('non-existent')).toBe(false)
    })

    it('should return true even when value is null', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.has('null-value-key')).toBe(true)
    })
  })

  describe('keys', () => {
    it('should return empty array for empty reader', () => {
      const reader = new LocalStorageReader([])
      expect(reader.keys()).toEqual([])
    })

    it('should return all keys', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const keys = reader.keys()
      expect(keys).toHaveLength(7)
      expect(keys).toContain('privacy-popup-accepted')
      expect(keys).toContain('provider:openai:token')
    })

    it('should return a new array each time', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const keys1 = reader.keys()
      const keys2 = reader.keys()
      expect(keys1).not.toBe(keys2)
      expect(keys1).toEqual(keys2)
    })
  })

  describe('getByPrefix', () => {
    it('should return all entries matching a prefix', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const result = reader.getByPrefix('provider:')
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({ key: 'provider:openai:token', value: 'sk-xxx' })
      expect(result).toContainEqual({ key: 'provider:anthropic:token', value: 'sk-ant-xxx' })
    })

    it('should return empty array when no keys match prefix', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.getByPrefix('nonexistent:')).toEqual([])
    })

    it('should return empty array for empty reader', () => {
      const reader = new LocalStorageReader([])
      expect(reader.getByPrefix('any')).toEqual([])
    })

    it('should match exact prefix (not substring)', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const result = reader.getByPrefix('provider')
      expect(result).toHaveLength(2)
    })
  })

  describe('getByPattern', () => {
    it('should match keys using glob pattern with *', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const result = reader.getByPattern('failed_favicon_*')
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({ key: 'failed_favicon_example.com', value: 1700000000000 })
      expect(result).toContainEqual({ key: 'failed_favicon_test.org', value: 1700000000001 })
    })

    it('should match keys using glob pattern with ?', () => {
      const records: LocalStorageRecord[] = [
        { key: 'item-a', value: 1 },
        { key: 'item-b', value: 2 },
        { key: 'item-ab', value: 3 }
      ]
      const reader = new LocalStorageReader(records)
      const result = reader.getByPattern('item-?')
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({ key: 'item-a', value: 1 })
      expect(result).toContainEqual({ key: 'item-b', value: 2 })
    })

    it('should return empty array when no keys match pattern', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.getByPattern('xyz_*')).toEqual([])
    })

    it('should handle exact match pattern (no wildcards)', () => {
      const reader = new LocalStorageReader(sampleRecords)
      const result = reader.getByPattern('privacy-popup-accepted')
      expect(result).toHaveLength(1)
      expect(result[0].value).toBe(true)
    })
  })

  describe('size', () => {
    it('should return 0 for empty reader', () => {
      const reader = new LocalStorageReader([])
      expect(reader.size).toBe(0)
    })

    it('should return correct count', () => {
      const reader = new LocalStorageReader(sampleRecords)
      expect(reader.size).toBe(7)
    })
  })
})
