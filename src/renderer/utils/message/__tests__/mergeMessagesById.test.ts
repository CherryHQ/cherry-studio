import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { mergeMessagesById } from '../mergeMessagesById'

function message(id: string, value: string, metadata?: CherryUIMessage['metadata']): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: value }],
    metadata
  } as CherryUIMessage
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
