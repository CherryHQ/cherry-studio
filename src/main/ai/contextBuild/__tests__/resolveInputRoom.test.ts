import { describe, expect, it } from 'vitest'

import { MIN_INPUT_ROOM_RATIO } from '@main/ai/constants'

import { resolveInputRoom } from '../resolveInputRoom'

describe('resolveInputRoom', () => {
  // Most openai-compatible requests send no max_tokens at all, so subtracting
  // anything would shrink every budget for a reservation the provider never
  // makes — and would make compaction fire earlier than it does today.
  it('leaves the window untouched when the request declares no max_tokens', () => {
    expect(resolveInputRoom(204_800, undefined)).toBe(204_800)
  })

  it('subtracts a declared reservation', () => {
    expect(resolveInputRoom(200_000, 64_000)).toBe(136_000)
  })

  // 83 registry models declare maxOutputTokens >= contextWindow (minimax-m2 is
  // 205000/205000). Unfloored, every window-relative budget goes non-positive
  // and the consumer compacts or truncates on every single step — #18318.
  it.each([
    ['equal to the window', 205_000, 205_000],
    ['larger than the window', 100_000, 1_048_600]
  ])('floors instead of collapsing when the reservation is %s', (_label, window, reservation) => {
    const room = resolveInputRoom(window, reservation)

    expect(room).toBe(Math.floor(window * MIN_INPUT_ROOM_RATIO))
    expect(room).toBeGreaterThan(0)
  })

  it('never returns more room than the window', () => {
    expect(resolveInputRoom(8_000, 0)).toBeLessThanOrEqual(8_000)
  })
})
