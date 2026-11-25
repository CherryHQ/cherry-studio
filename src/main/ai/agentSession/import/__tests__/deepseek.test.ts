import { describe, expect, it } from 'vitest'

import { parseDeepseekConversation } from '../deepseek'
import { conversation, message } from './fixtures'

// These guards prevent dropped branches and an invalid graph reaching persistent history.
describe('DeepSeek v3 message trees', () => {
  it('orders unsorted parents while keeping siblings and the selected nonfinal branch', () => {
    const input = conversation()
    input.messages.reverse()
    const parsed = parseDeepseekConversation(input)
    expect(parsed.messages.map((item) => [item.id, item.parent_id])).toEqual([
      [1, null],
      [3, 1],
      [2, 1]
    ])
    expect(parsed.current_message_id).toBe(2)
    expect(parsed.messages[0].fragments).toEqual([{ type: 'REQUEST', content: 'Remember the word mango' }])
  })
  it.each([
    [message(1, null, 'USER', ''), message(1, null, 'ASSISTANT', '')],
    [message(2, 99, 'USER', '')],
    [message(1, 2, 'USER', ''), message(2, 1, 'ASSISTANT', '')]
  ])('rejects duplicates, missing parents, and cycles', (...messages) => {
    expect(() => parseDeepseekConversation({ ...conversation(), messages })).toThrow()
  })
  it('does not discard empty, interrupted, or reasoning-only messages', () => {
    const input = conversation()
    input.messages[1] = {
      ...input.messages[1],
      status: 'TIMEOUT',
      fragments: [{ type: 'THINK', content: 'Partial thought', elapsed_secs: null }]
    }
    input.messages.push(message(4, 2, 'USER', ''))
    const parsed = parseDeepseekConversation(input)
    expect(parsed.messages).toHaveLength(4)
    expect(parsed.messages[1].status).toBe('TIMEOUT')
    expect(parsed.messages[1].fragments).toEqual(input.messages[1].fragments)
  })
  it('accepts an untitled empty conversation', () => {
    expect(
      parseDeepseekConversation({ ...conversation(), title: null, messages: [], current_message_id: null })
    ).toMatchObject({ title: null, messages: [] })
  })
  it('rejects unknown fragment types and an unavailable selected message', () => {
    expect(() => parseDeepseekConversation({ ...conversation(), current_message_id: 99 })).toThrow()
    expect(() =>
      parseDeepseekConversation({
        ...conversation(),
        messages: [{ ...message(2, null, 'USER', ''), fragments: [{ type: 'FUTURE' }] }]
      })
    ).toThrow()
  })
})
