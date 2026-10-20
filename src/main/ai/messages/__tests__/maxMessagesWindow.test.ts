import { describe, expect, it } from 'vitest'

import { applyMaxMessagesWindow, normalizeMaxMessages } from '../maxMessagesWindow'

const u = (id: string) => ({ id, role: 'user' })
const a = (id: string) => ({ id, role: 'assistant' })

describe('applyMaxMessagesWindow', () => {
  it('returns the input untouched when unlimited or already within the window', () => {
    const messages = [u('u1'), a('a1'), u('u2')]
    expect(applyMaxMessagesWindow(messages, null)).toBe(messages)
    expect(applyMaxMessagesWindow(messages, 3)).toBe(messages)
    expect(applyMaxMessagesWindow(messages, 10)).toBe(messages)
  })

  it('keeps exactly the last N when the window opens on a user row', () => {
    const messages = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3')]
    expect(applyMaxMessagesWindow(messages, 1).map((m) => m.id)).toEqual(['u3'])
    expect(applyMaxMessagesWindow(messages, 3).map((m) => m.id)).toEqual(['u2', 'a2', 'u3'])
  })

  it('extends backward to the turn-opening user row instead of starting on a reply', () => {
    const messages = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3')]
    // Last 2 = [a2, u3] → opens on a reply → extend back to u2.
    expect(applyMaxMessagesWindow(messages, 2).map((m) => m.id)).toEqual(['u2', 'a2', 'u3'])
  })

  it('keeps the resumed turn intact when the history ends on an assistant row (continue dispatch)', () => {
    const messages = [u('u1'), a('a1'), u('u2'), a('a2')]
    expect(applyMaxMessagesWindow(messages, 1).map((m) => m.id)).toEqual(['u2', 'a2'])
  })

  it('serves everything when no user row exists inside reach', () => {
    const messages = [a('a1'), a('a2'), a('a3')]
    expect(applyMaxMessagesWindow(messages, 1).map((m) => m.id)).toEqual(['a1', 'a2', 'a3'])
  })

  // Both sources load from the database unvalidated, and 0/negatives used to
  // read `.role` off `undefined`, failing the whole request.
  it('treats malformed limits as no limit instead of throwing', () => {
    const messages = [u('u1'), a('a1'), u('u2')]
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '2' as never, {} as never]) {
      expect(() => applyMaxMessagesWindow(messages, bad as never)).not.toThrow()
      expect(applyMaxMessagesWindow(messages, bad as never)).toBe(messages)
    }
  })

  it('floors a fractional limit', () => {
    expect(normalizeMaxMessages(2.7)).toBe(2)
    expect(normalizeMaxMessages(0.4)).toBeNull()
  })
})
