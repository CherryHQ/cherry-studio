import type { CherryUIMessageChunk } from '@shared/data/types/message'
import { describe, expect, it, vi } from 'vitest'

import { DSH_TRANSPORT, DshStreamAdapter } from '../dshStreamAdapter'

function makeAdapter() {
  const chunks: CherryUIMessageChunk[] = []
  const onAssistantUsage = vi.fn()
  const onTurnEnd = vi.fn()
  const onCompaction = vi.fn()
  const onApiRetry = vi.fn()
  const adapter = new DshStreamAdapter({
    enqueue: (chunk) => chunks.push(chunk),
    onAssistantUsage,
    onTurnEnd,
    onCompaction,
    onApiRetry
  })
  return { adapter, chunks, onAssistantUsage, onTurnEnd, onCompaction, onApiRetry }
}

let seq = 0
const envelope = (type: string, data: unknown) => ({ type, seq: ++seq, time: Date.now(), data })
const chunkEnvelope = (turn: number, step: number, chunk: unknown) => envelope('assistant/chunk', { turn, step, chunk })

describe('DshStreamAdapter', () => {
  it('maps a text turn to the expected chunk sequence and settles via onTurnEnd', () => {
    const { adapter, chunks, onTurnEnd } = makeAdapter()
    const events = [
      envelope('turn/start', { turn: 1 }),
      chunkEnvelope(1, 1, { type: 'block-start', index: 0, blockType: 'text' }),
      chunkEnvelope(1, 1, { type: 'text-delta', index: 0, text: 'Hello' }),
      chunkEnvelope(1, 1, { type: 'text-delta', index: 0, text: ' world' }),
      chunkEnvelope(1, 1, { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world' } }),
      envelope('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ]
    for (const event of events) adapter.handleEvent(event)

    expect(chunks.map((chunk) => chunk.type)).toEqual(['text-start', 'text-delta', 'text-delta', 'text-end'])
    const [start, delta] = chunks
    expect(start).toMatchObject({ id: expect.stringMatching(/^dsh-\d+-0$/) })
    expect(delta).toMatchObject({ id: (start as { id: string }).id, delta: 'Hello' })
    expect(onTurnEnd).toHaveBeenCalledWith({ kind: 'completed' })
  })

  it('maps reasoning blocks to reasoning chunks', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(chunkEnvelope(1, 1, { type: 'block-start', index: 0, blockType: 'reasoning' }))
    adapter.handleEvent(chunkEnvelope(1, 1, { type: 'reasoning-delta', index: 0, text: 'thinking…' }))
    adapter.handleEvent(
      chunkEnvelope(1, 1, { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking…' } })
    )

    expect(chunks.map((chunk) => chunk.type)).toEqual(['reasoning-start', 'reasoning-delta', 'reasoning-end'])
  })

  it('keeps block ids unique across the steps of one tool loop', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(chunkEnvelope(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
    adapter.handleEvent(chunkEnvelope(1, 2, { type: 'block-start', index: 0, blockType: 'text' }))

    const ids = chunks.map((chunk) => (chunk as { id: string }).id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('surfaces a tool call and its result with the dsh transport tag', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })
    )
    adapter.handleEvent(
      envelope('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'file.txt' }] }]
        }
      })
    )

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'tool-output-available'
    ])
    expect(chunks[1]).toMatchObject({
      toolCallId: 'c1',
      toolName: 'bash',
      input: { command: 'ls' },
      providerMetadata: { cherry: { transport: DSH_TRANSPORT } }
    })
    expect(chunks[2]).toMatchObject({ toolCallId: 'c1', output: [{ type: 'text', text: 'file.txt' }] })
  })

  it('degrades malformed tool arguments JSON to an empty input', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(envelope('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{oops' }))

    expect(chunks[1]).toMatchObject({ type: 'tool-input-available', input: {} })
  })

  it('maps a failed tool result to tool-output-error', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(envelope('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }))
    adapter.handleEvent(
      envelope('tool/result', {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'boom' }], isError: true }]
        },
        error: { name: 'ShellError', code: 'EXIT_1' }
      })
    )

    const error = chunks.find((chunk) => chunk.type === 'tool-output-error')
    expect(error).toMatchObject({ toolCallId: 'c1', errorText: 'boom' })
  })

  it('accumulates usage across the assistant messages of one turn', () => {
    const { adapter, chunks, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(envelope('turn/start', { turn: 1 }))
    adapter.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 1,
        message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm-1' } },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 1 }
      })
    )
    adapter.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 2,
        message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm-1' } },
        usage: { inputTokens: 20, outputTokens: 10 }
      })
    )

    const metadata = chunks.filter((chunk) => chunk.type === 'message-metadata')
    expect(metadata).toHaveLength(2)
    // First call: 10+2 prompt + 5 completion; second adds 20 prompt + 10 completion.
    expect(metadata[1]).toMatchObject({
      messageMetadata: {
        totalTokens: 47,
        stats: {
          inputTokens: 32,
          outputTokens: 15,
          totalTokens: 47,
          outputTokenDetails: { reasoningTokens: 1 }
        }
      }
    })
    expect(onAssistantUsage).toHaveBeenCalledTimes(2)
    expect(onAssistantUsage.mock.calls[0][0]).toMatchObject({
      turn: 1,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'm-1'
    })
  })

  it('measures per-step provider-call timing into onAssistantUsage metrics', () => {
    vi.useFakeTimers()
    try {
      const { adapter, onAssistantUsage } = makeAdapter()
      adapter.handleEvent(envelope('turn/start', { turn: 1 }))
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'block-start', index: 0, blockType: 'reasoning' }))
      vi.advanceTimersByTime(150)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'reasoning-delta', index: 0, text: 'hm' }))
      vi.advanceTimersByTime(250)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'block-end', index: 0, block: { type: 'reasoning' } }))
      vi.advanceTimersByTime(100)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'text-delta', index: 1, text: 'answer' }))
      vi.advanceTimersByTime(100)
      adapter.handleEvent(
        envelope('assistant/message', {
          turn: 1,
          step: 1,
          usage: { inputTokens: 10, outputTokens: 5 },
          message: { role: 'assistant' }
        })
      )

      expect(onAssistantUsage).toHaveBeenCalledTimes(1)
      expect(onAssistantUsage.mock.calls[0][0].metrics).toEqual({
        timeFirstTokenMs: 150,
        timeCompletionMs: 600,
        timeThinkingMs: 400
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits metrics when no chunk streamed before the assistant message', () => {
    const { adapter, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
        message: { role: 'assistant' }
      })
    )
    expect(onAssistantUsage).toHaveBeenCalledTimes(1)
    expect(onAssistantUsage.mock.calls[0][0].metrics).toBeUndefined()
  })

  it('ignores unknown and lifecycle-only events', () => {
    const { adapter, chunks, onTurnEnd } = makeAdapter()
    adapter.handleEvent(envelope('todo/write', { todos: [] }))
    adapter.handleEvent(envelope('approval/asked', { toolName: 'bash' }))
    adapter.handleEvent(envelope('request/header', { header: {} }))
    adapter.handleEvent(envelope('compaction/prune', { shadowedTokenCount: 512 }))
    adapter.handleEvent(envelope('some/future-event', { anything: true }))
    adapter.handleEvent(null)

    expect(chunks).toHaveLength(0)
    expect(onTurnEnd).not.toHaveBeenCalled()
  })

  it('maps a compaction fold to start + complete with region-scope anchor metrics', () => {
    const { adapter, chunks, onCompaction, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-1', turn: 3 }))
    adapter.handleEvent(
      envelope('compaction/summary', {
        compactionId: 'comp-1',
        summary: [{ type: 'text', text: '<compacted-summary>…</compacted-summary>' }],
        shadowedTokenCount: 42_000,
        provider: 'deepseek',
        model: 'deepseek-chat',
        usage: { inputTokens: 50_000, outputTokens: 1_800 }
      })
    )
    adapter.handleEvent(envelope('compaction/end', { compactionId: 'comp-1', turn: 3 }))

    expect(onCompaction).toHaveBeenCalledTimes(2)
    expect(onCompaction.mock.calls[0][0]).toEqual({ type: 'compaction-start', trigger: 'auto' })
    expect(onCompaction.mock.calls[1][0]).toMatchObject({
      type: 'compaction-complete',
      anchor: {
        status: 'done',
        phase: 'agent-session',
        trigger: 'auto',
        preTokens: 42_000,
        postTokens: 1_800
      }
    })
    // The summarize call's provider spend reaches the usage ledger with the summarizer's model.
    expect(onAssistantUsage).toHaveBeenCalledTimes(1)
    expect(onAssistantUsage.mock.calls[0][0]).toMatchObject({
      turn: 3,
      usage: { inputTokens: 50_000, outputTokens: 1_800 },
      model: 'deepseek-chat'
    })
    // Compaction never streams content chunks or turn-usage metadata.
    expect(chunks).toHaveLength(0)
  })

  it('reads a command-sourced fold as a manual compaction', () => {
    const { adapter, onCompaction } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-m', sourceCommandId: 'cmd-1', turn: null }))
    adapter.handleEvent(envelope('compaction/end', { compactionId: 'comp-m', sourceCommandId: 'cmd-1', turn: null }))

    expect(onCompaction.mock.calls[0][0]).toEqual({ type: 'compaction-start', trigger: 'manual' })
    expect(onCompaction.mock.calls[1][0].anchor).toMatchObject({ status: 'done', trigger: 'manual' })
  })

  it('maps a failed compaction to a non-terminal compaction-error', () => {
    const { adapter, onCompaction } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-2', turn: 1 }))
    adapter.handleEvent(envelope('compaction/end', { compactionId: 'comp-2', turn: 1, error: 'summary failed' }))

    expect(onCompaction.mock.calls.map((call) => call[0].type)).toEqual(['compaction-start', 'compaction-error'])
    expect(onCompaction.mock.calls[1][0]).toEqual({ type: 'compaction-error', error: 'summary failed' })
  })

  it('settles a summary-less fold with a metric-free anchor and no usage record', () => {
    const { adapter, onCompaction, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-3', turn: 2 }))
    adapter.handleEvent(envelope('compaction/end', { compactionId: 'comp-3', turn: 2 }))

    const complete = onCompaction.mock.calls[1][0]
    expect(complete.type).toBe('compaction-complete')
    expect(complete.anchor.preTokens).toBeUndefined()
    expect(complete.anchor.postTokens).toBeUndefined()
    expect(complete.anchor.status).toBe('done')
    expect(onAssistantUsage).not.toHaveBeenCalled()
  })

  it('maps a scheduled provider retry to the host api-retry status', () => {
    const { adapter, onApiRetry } = makeAdapter()
    adapter.handleEvent(
      envelope('llm/retry', {
        retryId: 'r-1',
        turn: 1,
        step: 1,
        provider: 'deepseek',
        mode: 'normal',
        policyKey: 'k',
        retry: 1,
        maxRetries: 2,
        delayMs: 500,
        failure: { message: 'rate limited', code: 'RATE_LIMIT', status: 429 }
      })
    )

    expect(onApiRetry).toHaveBeenCalledWith({
      attempt: 1,
      maxRetries: 2,
      retryDelayMs: 500,
      errorStatus: 429,
      errorCategory: 'RATE_LIMIT'
    })
  })
})
