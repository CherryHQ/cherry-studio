import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '../../types'
import { computeMessageSearchMatches, findTextMatches, toMessageSearchText } from '../messageSearch'

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart
const toolPart = (): CherryMessagePart =>
  ({ type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' }) as CherryMessagePart

const message = (
  id: string,
  role: MessageListItem['role'],
  status: MessageListItem['status'] = 'success'
): MessageListItem => ({ id, role, status, topicId: 'topic-1', createdAt: '2026-01-01T00:00:00.000Z' })

const DEFAULT_OPTIONS = {
  caseSensitive: false,
  wholeWord: false,
  includeUser: false,
  renderUserTextAsMarkdown: false
}

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

describe('toMessageSearchText', () => {
  it('matches rendered markdown labels without indexing link URLs, image alt text, or citation ids', () => {
    const text = toMessageSearchText('[foo](https://foo.example) ![hidden alt](image.png) [cite:internal-id]')
    expect(text).toContain('foo')
    expect(text).not.toContain('foo.example')
    expect(text).not.toContain('hidden alt')
    expect(text).not.toContain('internal-id')
  })

  it('uses parsed visible text for entities, escapes, and GFM tables', () => {
    const text = toMessageSearchText('A &amp; B and \\*literal\\*\n\n| alpha | beta |\n| --- | --- |')

    expect(text).toContain('A & B and *literal*')
    expect(text).toContain('alphabeta')
    expect(text).not.toContain('&amp;')
    expect(text).not.toContain('---')
  })

  it('keeps citation-like text in code while excluding rendered citation markers', () => {
    const text = toMessageSearchText('outside [cite:hidden]\n\n```text\n[cite:visible]\n```')

    expect(text).not.toContain('[cite:hidden]')
    expect(text).toContain('[cite:visible]')
  })

  it('uses visible HTML text while excluding controls and hidden metadata', () => {
    const text = toMessageSearchText('<button>Copy</button><span aria-hidden="true">Hidden</span><div>A &amp; B</div>')

    expect(text).toBe('A & B')
  })
})

describe('computeMessageSearchMatches', () => {
  it('matches assistant result parts in display order with stable original part ids', () => {
    const messages = [message('a1', 'assistant')]
    const parts = {
      a1: [textPart('First apple.'), textPart('Second apple.')]
    }

    expect(computeMessageSearchMatches(messages, parts, 'apple', DEFAULT_OPTIONS)).toEqual([
      { key: 'a1-part-0:0', messageId: 'a1', partId: 'a1-part-0', role: 'assistant', occurrence: 0 },
      { key: 'a1-part-1:0', messageId: 'a1', partId: 'a1-part-1', role: 'assistant', occurrence: 0 }
    ])
  })

  it('excludes completed process text before a tool and searches only the final result', () => {
    const messages = [message('a1', 'assistant')]
    const parts = {
      a1: [textPart('history apple'), toolPart(), textPart('final apple')]
    }

    expect(computeMessageSearchMatches(messages, parts, 'apple', DEFAULT_OPTIONS)).toEqual([
      { key: 'a1-part-2:0', messageId: 'a1', partId: 'a1-part-2', role: 'assistant', occurrence: 0 }
    ])
  })

  it('excludes pending assistant messages until streaming completes', () => {
    const messages = [message('a1', 'assistant', 'pending')]
    const parts = {
      a1: [textPart('history apple'), toolPart(), textPart('streaming apple')]
    }

    expect(computeMessageSearchMatches(messages, parts, 'apple', DEFAULT_OPTIONS)).toEqual([])
  })

  it('counts rendered markdown occurrences rather than raw URLs', () => {
    const messages = [message('a1', 'assistant')]
    const parts = { a1: [textPart('[foo](https://foo.example)')] }

    expect(computeMessageSearchMatches(messages, parts, 'foo', DEFAULT_OPTIONS)).toHaveLength(1)
    expect(computeMessageSearchMatches(messages, parts, 'foo.example', DEFAULT_OPTIONS)).toEqual([])
  })

  it('does not report non-rendered GFM table delimiters or encoded entity names', () => {
    const messages = [message('a1', 'assistant')]
    const parts = { a1: [textPart('A &amp; B\n\n| alpha | beta |\n| --- | --- |')] }

    expect(computeMessageSearchMatches(messages, parts, 'amp', DEFAULT_OPTIONS)).toEqual([])
    expect(computeMessageSearchMatches(messages, parts, '---', DEFAULT_OPTIONS)).toEqual([])
    expect(computeMessageSearchMatches(messages, parts, '&', DEFAULT_OPTIONS)).toHaveLength(1)
  })

  it('includes full user text only when requested and preserves plain-text rendering semantics', () => {
    const messages = [message('u1', 'user')]
    const parts = { u1: [textPart('preview\nline 2\nline 3\nline 4\nline 5\nhidden apple')] }

    expect(computeMessageSearchMatches(messages, parts, 'apple', DEFAULT_OPTIONS)).toEqual([])
    expect(computeMessageSearchMatches(messages, parts, 'apple', { ...DEFAULT_OPTIONS, includeUser: true })).toEqual([
      { key: 'u1-part-0:0', messageId: 'u1', partId: 'u1-part-0', role: 'user', occurrence: 0 }
    ])
  })

  it('excludes nested tool text without shifting original part ids', () => {
    const nestedToolText = {
      type: 'text',
      text: 'hidden apple',
      providerMetadata: { 'claude-code': { parentToolCallId: 'parent' } }
    } as CherryMessagePart
    const messages = [message('a1', 'assistant')]
    const parts = { a1: [nestedToolText, textPart('visible apple')] }

    expect(computeMessageSearchMatches(messages, parts, 'apple', DEFAULT_OPTIONS)).toEqual([
      { key: 'a1-part-1:0', messageId: 'a1', partId: 'a1-part-1', role: 'assistant', occurrence: 0 }
    ])
  })

  it('returns no matches for blank queries', () => {
    expect(
      computeMessageSearchMatches([message('a1', 'assistant')], { a1: [textPart('apple')] }, '   ', DEFAULT_OPTIONS)
    ).toEqual([])
  })
})
