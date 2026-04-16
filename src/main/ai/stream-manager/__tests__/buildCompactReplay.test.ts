import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { buildCompactReplay } from '../buildCompactReplay'

describe('buildCompactReplay', () => {
  it('merges consecutive text-delta chunks with the same id', () => {
    const result = buildCompactReplay([
      { type: 'text-start', id: 'p1' } as UIMessageChunk,
      { type: 'text-delta', id: 'p1', delta: 'hel' } as UIMessageChunk,
      { type: 'text-delta', id: 'p1', delta: 'lo' } as UIMessageChunk,
      { type: 'text-end', id: 'p1' } as UIMessageChunk
    ])

    expect(result).toEqual([
      { type: 'text-start', id: 'p1' },
      { type: 'text-delta', id: 'p1', delta: 'hello' },
      { type: 'text-end', id: 'p1' }
    ])
  })

  it('drops tool-input-start and tool-input-delta but keeps tool-input-available', () => {
    const result = buildCompactReplay([
      {
        type: 'tool-input-start',
        toolCallId: 'tool-1',
        toolName: 'search'
      } as UIMessageChunk,
      {
        type: 'tool-input-delta',
        toolCallId: 'tool-1',
        inputTextDelta: '{"q":"hel'
      } as UIMessageChunk,
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'search',
        input: { q: 'hello' }
      } as UIMessageChunk,
      {
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        output: { ok: true }
      } as UIMessageChunk
    ])

    expect(result).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'search',
        input: { q: 'hello' }
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        output: { ok: true }
      }
    ])
  })
})
