import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { buildCompactReplay } from '../buildCompactReplay'

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

    // B1 must not merge into A's run — and since execution B never announced
    // tc1 with a tool-input-start, its orphaned delta is dropped (the SDK
    // would throw on it). A1/A2 stay split because B1 interrupted the run.
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

    it('drops orphaned tool chunks whose part-creating chunk was evicted', () => {
      const result = buildCompactReplay([
        // tc1's tool-input-start was evicted: its delta cannot be repaired (no
        // toolName on a delta) and its output has no part to apply to.
        {
          topicId: 'topic-1',
          chunk: { type: 'tool-input-delta', toolCallId: 'tc1', inputTextDelta: 'lo"}' } as UIMessageChunk
        },
        {
          topicId: 'topic-1',
          chunk: { type: 'tool-output-available', toolCallId: 'tc1', output: { ok: true } } as UIMessageChunk
        },
        // tc2's tool-input-available survived — it recreates the part, so its
        // output stays replayable.
        {
          topicId: 'topic-1',
          chunk: {
            type: 'tool-input-available',
            toolCallId: 'tc2',
            toolName: 'search',
            input: { q: 'x' }
          } as UIMessageChunk
        },
        {
          topicId: 'topic-1',
          chunk: { type: 'tool-output-available', toolCallId: 'tc2', output: { ok: true } } as UIMessageChunk
        }
      ])

      expect(result).toEqual([
        {
          topicId: 'topic-1',
          chunk: { type: 'tool-input-available', toolCallId: 'tc2', toolName: 'search', input: { q: 'x' } }
        },
        { topicId: 'topic-1', chunk: { type: 'tool-output-available', toolCallId: 'tc2', output: { ok: true } } }
      ])
    })
  })
})
