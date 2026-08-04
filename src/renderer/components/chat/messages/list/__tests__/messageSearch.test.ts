import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { computeMessageSearchMatches, findTextMatches } from '../messageSearch'

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

const message = (id: string, role: CherryUIMessage['role'], parts: CherryMessagePart[]): CherryUIMessage =>
  ({ id, role, parts }) as CherryUIMessage

const DEFAULT_OPTIONS = { caseSensitive: false, wholeWord: false, includeUser: false }

describe('findTextMatches', () => {
  it('escapes regex metacharacters', () => {
    expect(findTextMatches('xx a+b(c) yy', 'a+b(c)', DEFAULT_OPTIONS)).toHaveLength(1)
    expect(findTextMatches('aab', 'a+b(c)', DEFAULT_OPTIONS)).toEqual([])
  })

  it('is case-insensitive by default', () => {
    expect(findTextMatches('says hello', 'Hello', DEFAULT_OPTIONS)).toHaveLength(1)
  })

  it('honors case sensitivity for English queries containing numbers', () => {
    const options = { caseSensitive: true, wholeWord: false }
    expect(findTextMatches('uses api2', 'API2', options)).toEqual([])
    expect(findTextMatches('uses API2', 'API2', options)).toHaveLength(1)
  })

  it('matches whole English words only when requested', () => {
    const options = { caseSensitive: false, wholeWord: true }
    expect(findTextMatches('a cat sat', 'cat', options)).toHaveLength(1)
    expect(findTextMatches('concatenate', 'cat', options)).toEqual([])
  })

  it('uses Chinese word boundaries for whole-word matching', () => {
    const options = { caseSensitive: false, wholeWord: true }
    expect(findTextMatches('你好世界，你好！', '你好', options)).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 }
    ])
    expect(findTextMatches('你好世界', '好世', options)).toEqual([])
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
