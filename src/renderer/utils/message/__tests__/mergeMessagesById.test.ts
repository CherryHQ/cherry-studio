import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { mergeLiveReplies, mergeMessagesById } from '../mergeMessagesById'

function message(id: string, value: string, metadata?: CherryUIMessage['metadata']): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: value }],
    metadata
  }
}

describe('mergeMessagesById', () => {
  it('preserves first-seen order and merges any later same-id messages', () => {
    const merged = mergeMessagesById(
      [message('a', 'first', { modelId: 'm1' }), message('b', 'second')],
      [message('a', 'intermediate', { totalTokens: 3 })],
      [message('a', 'latest', { status: 'success' })]
    )

    expect(merged.map((item) => item.id)).toEqual(['a', 'b'])
    expect(merged[0].parts).toEqual([{ type: 'text', text: 'latest' }])
    expect(merged[0].metadata).toEqual({ modelId: 'm1', totalTokens: 3, status: 'success' })
  })
})

it('uses the history index for live replies without reading unrelated rows in a 20,000-message branch', () => {
  const saved = message('selected', 'persisted', { totalTokens: 7 })
  const unread = new Proxy(message('old', 'history'), {
    get() {
      throw new Error('read an unrelated history message')
    }
  })
  const history = Array<CherryUIMessage>(20_000).fill(unread)
  history[2] = saved
  const lookups: string[] = []
  const position = (id: string) => {
    lookups.push(id)
    return id === 'selected' ? 2 : undefined
  }
  const reply = message('selected', 'live', { status: 'pending' })
  const other = message('other', 'new')
  expect(mergeLiveReplies(history, [], position, 'append')).toBe(history)
  expect(lookups).toEqual([])
  expect(mergeLiveReplies(history, [other], position, 'omit')).toBe(history)
  const visible = mergeLiveReplies(history, [reply, other], position, 'append')
  expect(lookups).toEqual(['other', 'selected', 'other'])
  expect(visible).toHaveLength(20_001)
  expect(visible[2]).toEqual(message('selected', 'live', { totalTokens: 7, status: 'pending' }))
  expect(visible.at(-1)).toBe(other)
  expect(history[2]).toBe(saved)
})
