import { describe, expect, it } from 'vitest'

import {
  collectV1TopicOrderIds,
  compareTopicLeftoversByUpdatedAtThenId,
  orderItemsByV1TopicSequence
} from '../v1TopicOrder'

describe('collectV1TopicOrderIds', () => {
  it('walks assistants[] then defaultAssistant and keeps first-write-wins identity', () => {
    expect(
      collectV1TopicOrderIds({
        assistants: [{ topics: [{ id: 'C' }, { id: 'A' }] }, { topics: [{ id: 'B' }, { id: 'A' }] }],
        defaultAssistant: { topics: [{ id: 'C' }, { id: 'D' }] }
      })
    ).toEqual(['C', 'A', 'B', 'D'])
  })

  it('skips missing ids and empty slots', () => {
    expect(
      collectV1TopicOrderIds({
        assistants: [{ topics: [{ id: '' }, { id: 'A' }, {}] }, { topics: null }],
        defaultAssistant: { topics: [{ id: null }, { id: 'B' }] }
      })
    ).toEqual(['A', 'B'])
  })

  it('returns [] when Redux has no topic arrays', () => {
    expect(collectV1TopicOrderIds(undefined)).toEqual([])
    expect(collectV1TopicOrderIds({})).toEqual([])
  })
})

describe('orderItemsByV1TopicSequence', () => {
  it('keeps Redux order and appends leftovers by updatedAt DESC then id', () => {
    const items = [
      { id: 'B', updatedAt: 300 },
      { id: 'dexie-z', updatedAt: 50 },
      { id: 'C', updatedAt: 100 },
      { id: 'A', updatedAt: 200 },
      { id: 'dexie-a', updatedAt: 50 }
    ]

    expect(
      orderItemsByV1TopicSequence(
        items,
        (item) => item.id,
        ['C', 'A', 'B'],
        compareTopicLeftoversByUpdatedAtThenId
      ).map((item) => item.id)
    ).toEqual(['C', 'A', 'B', 'dexie-a', 'dexie-z'])
  })

  it('ignores Redux ids that are not in the item set', () => {
    const items = [{ id: 'A', updatedAt: 1 }]
    expect(
      orderItemsByV1TopicSequence(
        items,
        (item) => item.id,
        ['missing', 'A'],
        compareTopicLeftoversByUpdatedAtThenId
      ).map((item) => item.id)
    ).toEqual(['A'])
  })
})
