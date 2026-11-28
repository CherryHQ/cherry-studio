import { describe, expect, it } from 'vitest'

import { getAdjacentConversation } from '../conversationCycle'

const conversations = [1, 2, 3, 4, 5].map((n) => ({
  id: `c${n}`,
  lastActivityAt: new Date(Date.UTC(2026, 0, 10 - n)).toISOString()
}))
// Deliberately unsorted input; c1 is the most recent.
const shuffled = [conversations[2], conversations[0], conversations[4], conversations[1], conversations[3]]

describe('getAdjacentConversation', () => {
  it('walks to older conversations with next and back with prev, without wrapping', () => {
    expect(getAdjacentConversation(shuffled, 'c3', 'next')?.id).toBe('c4')
    expect(getAdjacentConversation(shuffled, 'c4', 'next')?.id).toBe('c5')
    expect(getAdjacentConversation(shuffled, 'c5', 'next')).toBeUndefined()

    expect(getAdjacentConversation(shuffled, 'c5', 'prev')?.id).toBe('c4')
    expect(getAdjacentConversation(shuffled, 'c2', 'prev')?.id).toBe('c1')
    expect(getAdjacentConversation(shuffled, 'c1', 'prev')).toBeUndefined()
  })

  it('steps onto the most recent conversation when the active one is unknown', () => {
    expect(getAdjacentConversation(shuffled, null, 'next')?.id).toBe('c1')
    expect(getAdjacentConversation(shuffled, 'missing', 'prev')).toBeUndefined()
  })
})
