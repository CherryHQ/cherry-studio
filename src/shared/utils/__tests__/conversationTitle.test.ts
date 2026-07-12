import { describe, expect, it } from 'vitest'

import {
  buildFirstUserMessageTitle,
  normalizeConversationTitle,
  sanitizeConversationTitle,
  truncateFirstUserMessageTitleSource
} from '../conversationTitle'

describe('conversationTitle', () => {
  it.each([
    [' "Quoted"\nTitle ', 'Quoted Title'],
    ["It's\r\nfine", 'It s fine'],
    ['plain title', 'plain title']
  ])('sanitizes quotes and newlines: %s', (input, expected) => {
    expect(sanitizeConversationTitle(input)).toBe(expected)
  })

  it('normalizes case and whitespace for comparisons', () => {
    expect(normalizeConversationTitle('  Mixed\n\tCASE   Title  ')).toBe('mixed case title')
  })

  it('keeps an exactly 50-character first-message title source intact', () => {
    const input = 'a'.repeat(50)

    expect(truncateFirstUserMessageTitleSource(input)).toBe(input)
  })

  it('truncates a 51-character first-message title source to 50 characters', () => {
    expect(truncateFirstUserMessageTitleSource('a'.repeat(51))).toBe('a'.repeat(50))
  })

  it('does not leave a lone surrogate when the 50-char cut lands inside an emoji', () => {
    // 49 CJK chars fill indices 0-48; the emoji's high/low surrogate halves sit at
    // 49 and 50, so a plain slice(0, 50) keeps the high half without its low partner.
    const source = truncateFirstUserMessageTitleSource('字'.repeat(49) + '😀' + '文'.repeat(20))
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

    expect(loneSurrogate.test(source)).toBe(false)
    expect(source).toBe('字'.repeat(49))
  })

  it('returns an empty title for whitespace-only input', () => {
    expect(buildFirstUserMessageTitle(' \n\t ')).toBe('')
  })
})
