import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildMessageSearchRegex, computeMessageSearchMatches } from '../messageSearch'

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

const message = (id: string, role: CherryUIMessage['role'], parts: CherryMessagePart[]): CherryUIMessage =>
  ({ id, role, parts }) as CherryUIMessage

const DEFAULT_OPTIONS = { caseSensitive: false, wholeWord: false, includeUser: false }

describe('buildMessageSearchRegex', () => {
  it('escapes regex metacharacters', () => {
    const regex = buildMessageSearchRegex('a+b(c)', DEFAULT_OPTIONS)
    expect(regex.test('xx a+b(c) yy')).toBe(true)
    expect(regex.test('aab')).toBe(false)
  })

  it('is case-insensitive by default', () => {
    expect(buildMessageSearchRegex('Hello', DEFAULT_OPTIONS).test('says hello')).toBe(true)
  })

  it('honors case sensitivity for Latin-only queries', () => {
    const regex = buildMessageSearchRegex('Hello', { caseSensitive: true, wholeWord: false })
    expect(regex.test('says hello')).toBe(false)
    expect(regex.test('says Hello')).toBe(true)
  })

  it('ignores case sensitivity for non-Latin queries', () => {
    const regex = buildMessageSearchRegex('你好a', { caseSensitive: true, wholeWord: false })
    expect(regex.flags).toContain('i')
  })

  it('matches whole words only when requested', () => {
    const regex = buildMessageSearchRegex('cat', { caseSensitive: false, wholeWord: true })
    expect(regex.test('a cat sat')).toBe(true)
    expect(regex.test('concatenate')).toBe(false)
  })
})

describe('computeMessageSearchMatches', () => {
  const messages = [
    message('u1', 'user', [textPart('apple pie recipe')]),
    message('a1', 'assistant', [
      textPart('Here is an apple pie recipe.'),
      { type: 'reasoning', text: 'hidden apple' } as CherryMessagePart,
      textPart('Apples are essential.')
    ]),
    message('a2', 'assistant', [textPart('No fruit here.')])
  ]

  it('matches assistant messages only by default, in order, with per-part occurrences', () => {
    const matches = computeMessageSearchMatches(messages, undefined, 'apple', DEFAULT_OPTIONS)
    expect(matches).toEqual([
      { messageId: 'a1', textPartIndex: 0, occurrence: 0 },
      { messageId: 'a1', textPartIndex: 1, occurrence: 0 }
    ])
  })

  it('includes user messages when includeUser is set', () => {
    const matches = computeMessageSearchMatches(messages, undefined, 'apple', { ...DEFAULT_OPTIONS, includeUser: true })
    expect(matches.map((match) => match.messageId)).toEqual(['u1', 'a1', 'a1'])
  })

  it('returns no matches for blank queries', () => {
    expect(computeMessageSearchMatches(messages, undefined, '   ', DEFAULT_OPTIONS)).toEqual([])
  })

  it('prefers the partsByMessageId overlay over message.parts', () => {
    const overlay = { a2: [textPart('streaming apple text')] }
    const matches = computeMessageSearchMatches(messages, overlay, 'streaming', DEFAULT_OPTIONS)
    expect(matches).toEqual([{ messageId: 'a2', textPartIndex: 0, occurrence: 0 }])
  })

  it('excludes nested tool text without shifting rendered text part indices', () => {
    const nestedToolText = {
      type: 'text',
      text: 'hidden apple',
      providerMetadata: { 'claude-code': { parentToolCallId: 'parent' } }
    } as CherryMessagePart
    const matches = computeMessageSearchMatches(
      [message('a1', 'assistant', [nestedToolText, textPart('visible apple')])],
      undefined,
      'apple',
      DEFAULT_OPTIONS
    )

    expect(matches).toEqual([{ messageId: 'a1', textPartIndex: 0, occurrence: 0 }])
  })
})
