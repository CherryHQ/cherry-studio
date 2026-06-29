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

  it('returns an empty title for whitespace-only input', () => {
    expect(buildFirstUserMessageTitle(' \n\t ')).toBe('')
  })
})
