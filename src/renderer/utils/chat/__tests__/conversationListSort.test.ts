import { describe, expect, it } from 'vitest'

import { compareConversationListItems } from '../conversationListSort'
import { sortTopicsForDisplayGroups } from '../topicsHelpers'

const rows = [
  {
    id: 'old',
    assistantId: 'assistant',
    name: 'Z',
    orderKey: 'a0',
    createdAt: '2026-11-01T01:00:00Z',
    lastActivityAt: '2026-11-18T01:00:00Z'
  },
  {
    id: 'new',
    assistantId: 'assistant',
    name: 'A',
    orderKey: 'a1',
    createdAt: '2026-11-02T01:00:00Z',
    lastActivityAt: '2026-11-18T02:00:00Z'
  }
]

describe('independent conversation sorting', () => {
  it('keeps Unicode names in the database pagination order', () => {
    const input = [
      { ...rows[0], name: '😀' },
      { ...rows[1], name: '\uE000' }
    ]
    expect(input.toSorted(compareConversationListItems({ by: 'name', direction: 'asc' })).map((row) => row.id)).toEqual(
      ['new', 'old']
    )
  })

  it('keeps custom order after activity and recovers it after automatic sorting', () => {
    const manual = compareConversationListItems({ by: 'orderKey' })
    const recent = compareConversationListItems({ by: 'lastActivityAt', direction: 'desc' })
    const input = rows.map((row) => ({ ...row }))
    expect(input.toSorted(recent).map((row) => row.id)).toEqual(['new', 'old'])
    input[0].lastActivityAt = '2026-11-18T03:00:00Z'
    expect(input.toSorted(recent).map((row) => row.id)).toEqual(['old', 'new'])
    expect(input.toSorted(manual).map((row) => row.id)).toEqual(['old', 'new'])
    expect(input.map((row) => row.orderKey)).toEqual(['a0', 'a1'])
  })

  it('applies the selected rule inside time and owner groups', () => {
    const now = '2026-11-18T12:00:00Z'
    for (const mode of ['time', 'assistant'] as const) {
      expect(
        sortTopicsForDisplayGroups(rows, { mode, now, sort: { by: 'name', direction: 'asc' } }).map((row) => row.id)
      ).toEqual(['new', 'old'])
      expect(sortTopicsForDisplayGroups(rows, { mode, now, sort: { by: 'orderKey' } }).map((row) => row.id)).toEqual([
        'old',
        'new'
      ])
    }
  })
})
