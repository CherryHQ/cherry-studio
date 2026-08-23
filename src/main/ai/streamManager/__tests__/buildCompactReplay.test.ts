import { ConversationKind, toConversationExecutionId, toConversationTurnId } from '@shared/ai/conversation'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { buildCompactReplay, mergeDeltaPayload, splitDeltaPayload } from '../../conversation'

const conversation = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const turnId = toConversationTurnId('turn-1')
const executionId = toConversationExecutionId('execution-1')
let nextChunkSeq = 0

function payload(
  chunk: UIMessageChunk,
  overrides: Partial<Omit<StreamChunkPayload, 'chunk'>> = {}
): StreamChunkPayload {
  const chunkSeq = ++nextChunkSeq
  return {
    conversation,
    turnId,
    executionId,
    modelId: 'provider::model',
    outputNodeId: 'assistant-1',
    chunkSeq,
    throughChunkSeq: chunkSeq,
    chunk,
    ...overrides
  }
}

function chunks(result: readonly StreamChunkPayload[]): UIMessageChunk[] {
  return result.map((entry) => entry.chunk)
}

describe('buildCompactReplay', () => {
  it('merges consecutive text-delta chunks with the same id', () => {
    nextChunkSeq = 0
    const result = buildCompactReplay([
      payload({ type: 'text-start', id: 'p1' }),
      payload({ type: 'text-delta', id: 'p1', delta: 'hel' }),
      payload({ type: 'text-delta', id: 'p1', delta: 'lo' }),
      payload({ type: 'text-end', id: 'p1' })
    ])

    expect(chunks(result)).toEqual([
      { type: 'text-start', id: 'p1' },
      { type: 'text-delta', id: 'p1', delta: 'hello', providerMetadata: undefined },
      { type: 'text-end', id: 'p1' }
    ])
    expect(result[1]).toMatchObject({ chunkSeq: 2, throughChunkSeq: 3 })
  })

  it('does not merge text-delta chunks across different executions', () => {
    nextChunkSeq = 0
    const otherExecutionId = toConversationExecutionId('execution-2')
    const result = buildCompactReplay([
      payload({ type: 'text-start', id: 'p1' }),
      payload({ type: 'text-delta', id: 'p1', delta: 'hel' }),
      payload({ type: 'text-start', id: 'p1' }, { executionId: otherExecutionId }),
      payload({ type: 'text-delta', id: 'p1', delta: 'xx' }, { executionId: otherExecutionId }),
      payload({ type: 'text-delta', id: 'p1', delta: 'lo' }),
      payload({ type: 'text-end', id: 'p1' }),
      payload({ type: 'text-end', id: 'p1' }, { executionId: otherExecutionId })
    ])

    expect(chunks(result)).toEqual([
      { type: 'text-start', id: 'p1' },
      { type: 'text-delta', id: 'p1', delta: 'hel' },
      { type: 'text-start', id: 'p1' },
      { type: 'text-delta', id: 'p1', delta: 'xx' },
      { type: 'text-delta', id: 'p1', delta: 'lo' },
      { type: 'text-end', id: 'p1' },
      { type: 'text-end', id: 'p1' }
    ])
  })

  it('keeps tool-input-start so the renderer can rebuild the tool part on attach', () => {
    nextChunkSeq = 0
    const result = buildCompactReplay([
      payload({ type: 'tool-input-start', toolCallId: 'tc1', toolName: 'searchWeb' }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":"hel' }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'lo"}' })
    ])

    expect(chunks(result)).toEqual([
      { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'searchWeb' },
      { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":"hello"}' }
    ])
  })

  it('drops tool-input deltas whose structural start was evicted', () => {
    nextChunkSeq = 0
    const result = buildCompactReplay([
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":' }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '"hello"}' }),
      payload({ type: 'tool-input-available', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } })
    ])

    expect(chunks(result)).toEqual([
      { type: 'tool-input-available', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } }
    ])
  })

  it('merges consecutive tool-input-delta chunks with the same toolCallId', () => {
    nextChunkSeq = 0
    const result = buildCompactReplay([
      payload({ type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":' }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '"hello"}' }),
      payload({ type: 'tool-input-available', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } }),
      payload({ type: 'tool-output-available', toolCallId: 'tc1', output: { ok: true } })
    ])

    expect(chunks(result)).toEqual([
      { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' },
      { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":"hello"}' },
      { type: 'tool-input-available', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } },
      { type: 'tool-output-available', toolCallId: 'tc1', output: { ok: true } }
    ])
  })

  it('does not merge tool-input-delta chunks across different executions', () => {
    nextChunkSeq = 0
    const otherExecutionId = toConversationExecutionId('execution-2')
    const result = buildCompactReplay([
      payload({ type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A1' }),
      payload({ type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' }, { executionId: otherExecutionId }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'B1' }, { executionId: otherExecutionId }),
      payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A2' })
    ])

    expect(chunks(result)).toEqual([
      { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' },
      { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A1' },
      { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' },
      { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'B1' },
      { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A2' }
    ])
  })

  describe('orphan repair after ring eviction', () => {
    it('synthesizes the evicted start for a surviving text/reasoning delta run', () => {
      nextChunkSeq = 0
      const result = buildCompactReplay([
        payload({ type: 'reasoning-delta', id: 'r1', delta: 'tail ' }),
        payload({ type: 'reasoning-delta', id: 'r1', delta: 'text' }),
        payload({ type: 'reasoning-end', id: 'r1' }),
        payload({ type: 'text-start', id: 'p1' }),
        payload({ type: 'text-delta', id: 'p1', delta: 'answer' })
      ])

      expect(chunks(result)).toEqual([
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'tail text', providerMetadata: undefined },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 'p1' },
        { type: 'text-delta', id: 'p1', delta: 'answer' }
      ])
    })

    it('drops an end whose start and content were all evicted', () => {
      nextChunkSeq = 0
      const result = buildCompactReplay([
        payload({ type: 'reasoning-end', id: 'r1' }),
        payload({ type: 'text-end', id: 'p1' }),
        payload({ type: 'text-start', id: 'p2' })
      ])

      expect(chunks(result)).toEqual([{ type: 'text-start', id: 'p2' }])
    })
  })

  describe('mergeDeltaPayload segmentation', () => {
    it('refuses a merge that would exceed maxDeltaBytes so ingest starts a new segment', () => {
      nextChunkSeq = 0
      const tail = payload({ type: 'text-delta', id: 'p1', delta: 'abcd' })
      const incoming = payload({ type: 'text-delta', id: 'p1', delta: 'ef' })

      expect(mergeDeltaPayload(tail, incoming, 5)).toBeUndefined()
      expect(mergeDeltaPayload(tail, incoming, 6)).toMatchObject({ chunk: { delta: 'abcdef' } })
      expect(mergeDeltaPayload(tail, incoming)).toMatchObject({ chunk: { delta: 'abcdef' } })
    })

    it('measures the merge ceiling in UTF-8 bytes', () => {
      nextChunkSeq = 0
      const tail = payload({ type: 'text-delta', id: 'p1', delta: '中' })
      const incoming = payload({ type: 'text-delta', id: 'p1', delta: 'a' })

      expect(mergeDeltaPayload(tail, incoming, 3)).toBeUndefined()
      expect(mergeDeltaPayload(tail, incoming, 4)).toMatchObject({ chunk: { delta: '中a' } })
    })

    it('caps tool-input-delta merges the same way', () => {
      nextChunkSeq = 0
      const tail = payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q"' })
      const incoming = payload({ type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: ':1}' })

      expect(mergeDeltaPayload(tail, incoming, 6)).toBeUndefined()
      expect(mergeDeltaPayload(tail, incoming, 7)).toMatchObject({ chunk: { inputTextDelta: '{"q":1}' } })
    })

    it('splits one oversized incoming delta without breaking Unicode code points', () => {
      nextChunkSeq = 0
      const result = splitDeltaPayload(payload({ type: 'text-delta', id: 'p1', delta: 'a🙂bc' }), 4)

      expect(result.map(({ chunk }) => ('delta' in chunk ? chunk.delta : undefined))).toEqual(['a', '🙂', 'bc'])
    })

    it('keeps attach-time compaction under the same delta byte ceiling', () => {
      nextChunkSeq = 0
      const result = buildCompactReplay(
        [
          payload({ type: 'text-start', id: 'p1' }),
          payload({ type: 'text-delta', id: 'p1', delta: 'abcd' }),
          payload({ type: 'text-delta', id: 'p1', delta: 'efgh' })
        ],
        4
      )

      expect(chunks(result)).toEqual([
        { type: 'text-start', id: 'p1' },
        { type: 'text-delta', id: 'p1', delta: 'abcd' },
        { type: 'text-delta', id: 'p1', delta: 'efgh' }
      ])
    })
  })
})
