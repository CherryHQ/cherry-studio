import { describe, expect, it } from 'vitest'

import { splitMessage } from '../utils'

// Matches a lone surrogate: a high surrogate not followed by a low one, or a
// low surrogate not preceded by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('splitMessage', () => {
  it('returns the text unchanged when it fits', () => {
    expect(splitMessage('hello 😀', 100)).toEqual(['hello 😀'])
  })

  it('does not split a surrogate pair when falling back to a hard cut', () => {
    // CJK text has no spaces, so the hard-cut fallback is the only option. Place
    // an emoji straddling the limit (9 CJK chars = indices 0-8, emoji at 9-10).
    const text = '字'.repeat(9) + '😀' + '文'.repeat(20)
    const chunks = splitMessage(text, 10)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(LONE_SURROGATE.test(chunk)).toBe(false)
    }
    // The emoji stays whole and is carried into the next chunk.
    expect(chunks[0]).toBe('字'.repeat(9))
    expect(chunks.join('')).toContain('😀')
  })

  it('still prefers whitespace boundaries when available', () => {
    const chunks = splitMessage('aaaa bbbb cccc', 6)
    expect(chunks[0]).toBe('aaaa')
  })
})
