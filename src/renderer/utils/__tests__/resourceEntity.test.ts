import { describe, expect, it } from 'vitest'

import { findLatestUpdated, isUntouchedSinceCreation } from '../resourceEntity'

describe('resourceEntity', () => {
  describe('isUntouchedSinceCreation', () => {
    it('is true only when updatedAt equals a present createdAt', () => {
      expect(
        isUntouchedSinceCreation({ createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' })
      ).toBe(true)
    })

    it('is false once updatedAt has moved past createdAt (chatted-in, even with a blank name)', () => {
      expect(
        isUntouchedSinceCreation({ createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z' })
      ).toBe(false)
    })

    it('treats a row missing either timestamp as touched (not reusable)', () => {
      expect(isUntouchedSinceCreation({ updatedAt: '2024-01-01T00:00:00.000Z' })).toBe(false)
      expect(isUntouchedSinceCreation({ createdAt: '2024-01-01T00:00:00.000Z' })).toBe(false)
      expect(isUntouchedSinceCreation({})).toBe(false)
    })
  })

  describe('findLatestUpdated', () => {
    it('should return undefined for an empty list', () => {
      expect(findLatestUpdated([])).toBeUndefined()
    })

    it('should return the only item for a single-item list', () => {
      const item = { id: 'a', updatedAt: '2024-01-01T00:00:00.000Z' }
      expect(findLatestUpdated([item])).toBe(item)
    })

    it('should pick the item with the most recent updatedAt', () => {
      const older = { id: 'older', updatedAt: '2024-01-01T00:00:00.000Z' }
      const newest = { id: 'newest', updatedAt: '2024-03-01T00:00:00.000Z' }
      const middle = { id: 'middle', updatedAt: '2024-02-01T00:00:00.000Z' }
      expect(findLatestUpdated([older, newest, middle])).toBe(newest)
    })

    it('should sort missing or unparseable updatedAt as oldest', () => {
      const missing = { id: 'missing', updatedAt: undefined }
      const empty = { id: 'empty', updatedAt: '' }
      const unparseable = { id: 'unparseable', updatedAt: 'not-a-date' }
      const dated = { id: 'dated', updatedAt: '2024-01-01T00:00:00.000Z' }
      expect(findLatestUpdated([missing, empty, unparseable, dated])).toBe(dated)
    })

    it('should keep the first item encountered on a tie', () => {
      const first = { id: 'first', updatedAt: '2024-01-01T00:00:00.000Z' }
      const second = { id: 'second', updatedAt: '2024-01-01T00:00:00.000Z' }
      expect(findLatestUpdated([first, second])).toBe(first)
    })
  })
})
