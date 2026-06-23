import type { CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

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
  it('preserves first-seen order and lets later messages override earlier fields', () => {
    const merged = mergeMessagesById(
      [message('a', 'first', { modelId: 'm1' }), message('b', 'second')],
      [message('a', 'updated', { totalTokens: 3 })]
    )

    expect(merged.map((item) => item.id)).toEqual(['a', 'b'])
    expect(merged[0].parts).toEqual([{ type: 'text', text: 'updated' }])
    expect(merged[0].metadata).toEqual({ modelId: 'm1', totalTokens: 3 })
  })

  it('merges three or more sources, with the latest source winning same-id collisions', () => {
    const merged = mergeMessagesById(
      [message('a', 'a-v1')],
      [message('b', 'b-only')],
      [message('a', 'a-v3', { totalTokens: 9 })]
    )

    expect(merged.map((item) => item.id)).toEqual(['a', 'b'])
    expect(merged[0].parts).toEqual([{ type: 'text', text: 'a-v3' }])
    expect(merged[0].metadata).toEqual({ totalTokens: 9 })
  })
})
