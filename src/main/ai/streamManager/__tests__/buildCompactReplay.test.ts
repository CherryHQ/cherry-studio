import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { buildCompactReplay, mergeDeltaPayload, splitDeltaPayload } from '../buildCompactReplay'

describe('buildCompactReplay', () => {
  it('merges consecutive text-delta chunks with the same id', () => {
    const result = buildCompactReplay([
      { topicId: 'topic-1', chunk: { type: 'text-start', id: 'p1' } as UIMessageChunk },
      { topicId: 'topic-1', chunk: { type: 'text-delta', id: 'p1', delta: 'hel' } as UIMessageChunk },
      { topicId: 'topic-1', chunk: { type: 'text-delta', id: 'p1', delta: 'lo' } as UIMessageChunk },
      { topicId: 'topic-1', chunk: { type: 'text-end', id: 'p1' } as UIMessageChunk }
    ])

    expect(result).toEqual([
      { topicId: 'topic-1', chunk: { type: 'text-start', id: 'p1' } },
      { topicId: 'topic-1', chunk: { type: 'text-delta', id: 'p1', delta: 'hello' } },
      { topicId: 'topic-1', chunk: { type: 'text-end', id: 'p1' } }
    ])
  })

  it('does not merge text-delta chunks across different executions', () => {
    const result = buildCompactReplay([
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-start', id: 'p1' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-delta', id: 'p1', delta: 'hel' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'text-start', id: 'p1' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'text-delta', id: 'p1', delta: 'xx' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-delta', id: 'p1', delta: 'lo' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-end', id: 'p1' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'text-end', id: 'p1' } as UIMessageChunk
      }
    ])

    expect(result).toEqual([
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-start', id: 'p1' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-delta', id: 'p1', delta: 'hel' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'text-start', id: 'p1' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'text-delta', id: 'p1', delta: 'xx' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-delta', id: 'p1', delta: 'lo' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'text-end', id: 'p1' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'text-end', id: 'p1' }
      }
    ])
  })

  it('keeps tool-input-start so the renderer can rebuild the tool part on attach', () => {
    // Regression: when attach happens mid-tool-input (before tool-input-available is
    // emitted), compact replay must preserve `tool-input-start` — otherwise the
    // renderer's chat reducer never sees the toolCallId, drops subsequent live deltas,
    // and the tool call only materializes when tool-input-available eventually arrives.
    const result = buildCompactReplay([
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'searchWeb' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":"hel' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'lo"}' } as UIMessageChunk
      }
    ])

    expect(result).toEqual([
      { topicId: 'topic-1', chunk: { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'searchWeb' } },
      { topicId: 'topic-1', chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":"hello"}' } }
    ])
  })

  it('merges consecutive tool-input-delta chunks with the same toolCallId', () => {
    const result = buildCompactReplay([
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '"hello"}' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        chunk: {
          type: 'tool-input-available',
          toolCallId: 'tc1',
          toolName: 'search',
          input: { q: 'hello' }
        } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-output-available', toolCallId: 'tc1', output: { ok: true } } as UIMessageChunk
      }
    ])

    expect(result).toEqual([
      { topicId: 'topic-1', chunk: { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' } },
      { topicId: 'topic-1', chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q":"hello"}' } },
      {
        topicId: 'topic-1',
        chunk: { type: 'tool-input-available', toolCallId: 'tc1', toolName: 'search', input: { q: 'hello' } }
      },
      { topicId: 'topic-1', chunk: { type: 'tool-output-available', toolCallId: 'tc1', output: { ok: true } } }
    ])
  })

  it('does not merge tool-input-delta chunks across different executions', () => {
    const result = buildCompactReplay([
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A1' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'B1' } as UIMessageChunk
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A2' } as UIMessageChunk
      }
    ])

    // B1 must not merge into A's run. Tool chunks otherwise preserve the
    // pre-existing pass-through behavior; A1/A2 stay split because B1
    // interrupted the run.
    expect(result).toEqual([
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'tool-input-start', toolCallId: 'tc1', toolName: 'search' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A1' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-b::model-b',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'B1' }
      },
      {
        topicId: 'topic-1',
        executionId: 'provider-a::model-a',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'A2' }
      }
    ])
  })

  describe('orphan repair after ring eviction', () => {
    it('synthesizes the evicted start for a surviving text/reasoning delta run', () => {
      const result = buildCompactReplay([
        // reasoning-start for r1 was evicted; its tail deltas + end survived.
        { topicId: 'topic-1', chunk: { type: 'reasoning-delta', id: 'r1', delta: 'tail ' } as UIMessageChunk },
        { topicId: 'topic-1', chunk: { type: 'reasoning-delta', id: 'r1', delta: 'text' } as UIMessageChunk },
        { topicId: 'topic-1', chunk: { type: 'reasoning-end', id: 'r1' } as UIMessageChunk },
        { topicId: 'topic-1', chunk: { type: 'text-start', id: 'p1' } as UIMessageChunk },
        { topicId: 'topic-1', chunk: { type: 'text-delta', id: 'p1', delta: 'answer' } as UIMessageChunk }
      ])

      expect(result).toEqual([
        { topicId: 'topic-1', chunk: { type: 'reasoning-start', id: 'r1' } },
        { topicId: 'topic-1', chunk: { type: 'reasoning-delta', id: 'r1', delta: 'tail text' } },
        { topicId: 'topic-1', chunk: { type: 'reasoning-end', id: 'r1' } },
        { topicId: 'topic-1', chunk: { type: 'text-start', id: 'p1' } },
        { topicId: 'topic-1', chunk: { type: 'text-delta', id: 'p1', delta: 'answer' } }
      ])
    })

    it('drops an end whose start and content were all evicted', () => {
      const result = buildCompactReplay([
        { topicId: 'topic-1', chunk: { type: 'reasoning-end', id: 'r1' } as UIMessageChunk },
        { topicId: 'topic-1', chunk: { type: 'text-end', id: 'p1' } as UIMessageChunk },
        { topicId: 'topic-1', chunk: { type: 'text-start', id: 'p2' } as UIMessageChunk }
      ])

      expect(result).toEqual([{ topicId: 'topic-1', chunk: { type: 'text-start', id: 'p2' } }])
    })
  })

  describe('mergeDeltaPayload segmentation', () => {
    it('refuses a merge that would exceed maxDeltaBytes so ingest starts a new segment', () => {
      const tail = { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'abcd' } as UIMessageChunk }
      const incoming = { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'ef' } as UIMessageChunk }

      expect(mergeDeltaPayload(tail, incoming, 5)).toBeUndefined()
      expect(mergeDeltaPayload(tail, incoming, 6)).toMatchObject({ chunk: { delta: 'abcdef' } })
      expect(mergeDeltaPayload(tail, incoming)).toMatchObject({ chunk: { delta: 'abcdef' } })
    })

    it('measures the merge ceiling in UTF-8 bytes', () => {
      const tail = { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: '中' } as UIMessageChunk }
      const incoming = { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'a' } as UIMessageChunk }

      expect(mergeDeltaPayload(tail, incoming, 3)).toBeUndefined()
      expect(mergeDeltaPayload(tail, incoming, 4)).toMatchObject({ chunk: { delta: '中a' } })
    })

    it('caps tool-input-delta merges the same way', () => {
      const tail = {
        topicId: 't',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: '{"q"' } as UIMessageChunk
      }
      const incoming = {
        topicId: 't',
        chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: ':1}' } as UIMessageChunk
      }

      expect(mergeDeltaPayload(tail, incoming, 6)).toBeUndefined()
      expect(mergeDeltaPayload(tail, incoming, 7)).toMatchObject({ chunk: { inputTextDelta: '{"q":1}' } })
    })

    it('splits one oversized incoming delta without breaking Unicode code points', () => {
      const payload = {
        topicId: 't',
        chunk: { type: 'text-delta', id: 'p1', delta: 'a🙂bc' } as UIMessageChunk
      }

      expect(splitDeltaPayload(payload, 4).map(({ chunk }) => ('delta' in chunk ? chunk.delta : undefined))).toEqual([
        'a',
        '🙂',
        'bc'
      ])
    })

    it('keeps attach-time compaction under the same delta byte ceiling', () => {
      const result = buildCompactReplay(
        [
          { topicId: 't', chunk: { type: 'text-start', id: 'p1' } as UIMessageChunk },
          { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'abcd' } as UIMessageChunk },
          { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'efgh' } as UIMessageChunk }
        ],
        4
      )

      expect(result).toEqual([
        { topicId: 't', chunk: { type: 'text-start', id: 'p1' } },
        { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'abcd' } },
        { topicId: 't', chunk: { type: 'text-delta', id: 'p1', delta: 'efgh' } }
      ])
    })
  })
})
