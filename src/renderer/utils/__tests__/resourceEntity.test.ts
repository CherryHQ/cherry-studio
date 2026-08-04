import { describe, expect, it } from 'vitest'

import { findLatestCreated, isUntouchedSinceCreation, pickNeighbourAfterRemoval } from '../resourceEntity'

describe('resourceEntity', () => {
  describe('isUntouchedSinceCreation', () => {
    it('is true only when lastActivityAt equals a present createdAt', () => {
      expect(
        isUntouchedSinceCreation({
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActivityAt: '2024-01-01T00:00:00.000Z'
        })
      ).toBe(true)
    })

    it('is false once lastActivityAt has moved past createdAt (chatted-in, even with a blank name)', () => {
      expect(
        isUntouchedSinceCreation({
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActivityAt: '2024-01-02T00:00:00.000Z'
        })
      ).toBe(false)
    })

    it('treats a row missing either timestamp as touched (not reusable)', () => {
      expect(isUntouchedSinceCreation({ lastActivityAt: '2024-01-01T00:00:00.000Z' })).toBe(false)
      expect(isUntouchedSinceCreation({ createdAt: '2024-01-01T00:00:00.000Z' })).toBe(false)
      expect(isUntouchedSinceCreation({})).toBe(false)
    })
  })

  describe('findLatestCreated', () => {
    it('should return undefined for an empty list', () => {
      expect(findLatestCreated([])).toBeUndefined()
    })

    it('should return the only item for a single-item list', () => {
      const item = { id: 'a', createdAt: '2024-01-01T00:00:00.000Z' }
      expect(findLatestCreated([item])).toBe(item)
    })

    it('should pick the item with the most recent createdAt', () => {
      const older = { id: 'older', createdAt: '2024-01-01T00:00:00.000Z' }
      const newest = { id: 'newest', createdAt: '2024-03-01T00:00:00.000Z' }
      const middle = { id: 'middle', createdAt: '2024-02-01T00:00:00.000Z' }
      expect(findLatestCreated([older, newest, middle])).toBe(newest)
    })

    it('should sort missing or unparseable createdAt as oldest', () => {
      const missing = { id: 'missing', createdAt: undefined }
      const empty = { id: 'empty', createdAt: '' }
      const unparseable = { id: 'unparseable', createdAt: 'not-a-date' }
      const dated = { id: 'dated', createdAt: '2024-01-01T00:00:00.000Z' }
      expect(findLatestCreated([missing, empty, unparseable, dated])).toBe(dated)
    })

    it('should keep the first item encountered on a tie', () => {
      const first = { id: 'first', createdAt: '2024-01-01T00:00:00.000Z' }
      const second = { id: 'second', createdAt: '2024-01-01T00:00:00.000Z' }
      expect(findLatestCreated([first, second])).toBe(first)
    })
  })

  describe('pickNeighbourAfterRemoval', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    it('picks the next row in display order', () => {
      expect(pickNeighbourAfterRemoval(list, 'a')).toEqual({ id: 'b' })
      expect(pickNeighbourAfterRemoval(list, 'b')).toEqual({ id: 'c' })
    })

    it('picks the previous row when the removed row was last', () => {
      expect(pickNeighbourAfterRemoval(list, 'c')).toEqual({ id: 'b' })
    })

    it('returns undefined when the id is absent or it was the only row', () => {
      expect(pickNeighbourAfterRemoval(list, 'missing')).toBeUndefined()
      expect(pickNeighbourAfterRemoval([{ id: 'only' }], 'only')).toBeUndefined()
      expect(pickNeighbourAfterRemoval([], 'a')).toBeUndefined()
    })
  })
})
