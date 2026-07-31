import type {
  AssistantMessage,
  CallId,
  ContentBlock,
  ImageBlock,
  MessageId,
  StreamChunk,
  ToolResultMessage
} from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'

import type { CherryUIMessageChunk } from '@shared/data/types/message'

import { DSH_TRANSPORT, DshStreamAdapter } from '../dshStreamAdapter'

type DshCompactionId = SessionEventMap['compaction/start']['compactionId']
type DshCommandId = NonNullable<SessionEventMap['compaction/start']['sourceCommandId']>
type DshRetryId = SessionEventMap['llm/retry']['retryId']

const callId = (id: string) => id as CallId

const assistantMessage = (model = 'm-1'): AssistantMessage => ({
  id: 'msg-1' as MessageId,
  role: 'assistant',
  content: [],
  source: { kind: 'model', provider: 'p', model }
})

const toolResultMessage = (id: string, content: ContentBlock[], isError?: boolean): ToolResultMessage => ({
  id: `msg-${id}` as MessageId,
  role: 'user',
  content: [{ type: 'tool-result', toolCallId: callId(id), content, ...(isError !== undefined ? { isError } : {}) }],
  source: { kind: 'tool', callId: callId(id) }
})

function makeAdapter() {
  const chunks: CherryUIMessageChunk[] = []
  /** Interleaved sink order: chunk types and lifecycle markers, for ordering assertions. */
  const order: string[] = []
  const onAssistantUsage = vi.fn()
  const onTurnEnd = vi.fn(() => order.push('turn-end'))
  const onCompaction = vi.fn()
  const onApiRetry = vi.fn()
  const onAutonomousTurnState = vi.fn((state: 'started' | 'finished') => order.push(`autonomous:${state}`))
  const onPlanMode = vi.fn()
  const adapter = new DshStreamAdapter({
    enqueue: (chunk) => {
      chunks.push(chunk)
      order.push(chunk.type)
    },
    onAssistantUsage,
    onTurnEnd,
    onCompaction,
    onApiRetry,
    onAutonomousTurnState,
    onPlanMode
  })
  return {
    adapter,
    chunks,
    order,
    onAssistantUsage,
    onTurnEnd,
    onCompaction,
    onApiRetry,
    onAutonomousTurnState,
    onPlanMode
  }
}

let seq = 0
const envelope = <T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent =>
  ({ type, seq: ++seq, time: Date.now(), data }) as SessionEvent
/** An event outside the compile-time union (merge-extended or lifecycle-only shape). */
const rawEvent = (type: string, data: unknown): SessionEvent =>
  ({ type, seq: ++seq, time: Date.now(), data }) as unknown as SessionEvent
const chunkEnvelope = (turn: number, step: number, chunk: StreamChunk) =>
  envelope('assistant/chunk', { turn, step, chunk })

describe('DshStreamAdapter', () => {
  it('relays committed plan/mode folds to the sink', () => {
    const { adapter, onPlanMode } = makeAdapter()
    adapter.handleEvent(rawEvent('plan/mode', { active: true }))
    adapter.handleEvent(rawEvent('plan/mode', { active: false }))
    expect(onPlanMode.mock.calls).toEqual([[true], [false]])
  })

  it('maps a text turn to the expected chunk sequence and settles via onTurnEnd', () => {
    const { adapter, chunks, onTurnEnd, onAutonomousTurnState } = makeAdapter()
    adapter.beginTurn()
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
    // A host-prompted turn never reports autonomous lifecycle.
    expect(onAutonomousTurnState).not.toHaveBeenCalled()
  })

  it('self-opens an autonomous turn on unprompted content and releases before turn-complete', () => {
    const { adapter, order, onTurnEnd, onAutonomousTurnState } = makeAdapter()
    // No beginTurn(): a goal-round turn the host never prompted.
    adapter.handleEvent(envelope('turn/start', { turn: 2 }))
    adapter.handleEvent(chunkEnvelope(2, 1, { type: 'block-start', index: 0, blockType: 'text' }))
    adapter.handleEvent(chunkEnvelope(2, 1, { type: 'text-delta', index: 0, text: 'round work' }))
    adapter.handleEvent(envelope('turn/end', { turn: 2, reason: { kind: 'completed' } }))

    // `started` precedes the first chunk; `finished` precedes the terminal onTurnEnd.
    expect(order).toEqual(['autonomous:started', 'text-start', 'text-delta', 'autonomous:finished', 'turn-end'])
    expect(onAutonomousTurnState.mock.calls.map((call) => call[0])).toEqual(['started', 'finished'])
    expect(onTurnEnd).toHaveBeenCalledWith({ kind: 'completed' })
  })

  it('swallows a content-less turn instead of fabricating an empty one', () => {
    // A stale goal round rejected at pre-step: turn/start → turn/end {blocked}, zero content.
    const { adapter, chunks, onTurnEnd, onAutonomousTurnState } = makeAdapter()
    adapter.handleEvent(envelope('turn/start', { turn: 3 }))
    adapter.handleEvent(envelope('turn/end', { turn: 3, reason: { kind: 'blocked' } }))

    expect(chunks).toHaveLength(0)
    expect(onTurnEnd).not.toHaveBeenCalled()
    expect(onAutonomousTurnState).not.toHaveBeenCalled()
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
      envelope('tool/call', { turn: 1, step: 1, callId: callId('c1'), name: 'bash', arguments: '{"command":"ls"}' })
    )
    adapter.handleEvent(
      envelope('tool/result', {
        turn: 1,
        step: 1,
        message: toolResultMessage('c1', [{ type: 'text', text: 'file.txt' }])
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
    expect(chunks[2]).toMatchObject({ toolCallId: 'c1', output: 'file.txt' })
  })

  it('materializes an approval tool part ahead of its tool/call event, without duplicating it', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.beginTurn()
    adapter.ensureToolCall('c1', 'bash', { command: 'rm -rf build' })
    adapter.handleEvent(envelope('turn/start', { turn: 1 }))
    // The late session event for the same call must not re-open the part (it would reset an
    // already-rendered approval back to input-streaming).
    adapter.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('c1'), name: 'bash', arguments: '{"command":"ls"}' })
    )
    adapter.handleEvent(
      envelope('tool/result', {
        turn: 1,
        step: 1,
        message: toolResultMessage('c1', [{ type: 'text', text: 'done' }])
      })
    )

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'tool-input-start',
      'tool-input-available',
      'tool-output-available'
    ])
    expect(chunks[1]).toMatchObject({ toolCallId: 'c1', toolName: 'bash', input: { command: 'rm -rf build' } })
    expect(chunks[2]).toMatchObject({
      toolCallId: 'c1',
      providerMetadata: { cherry: { tool: { type: 'builtin', name: 'bash' } } }
    })
  })

  it('unwraps an all-text tool result into its structured payload', () => {
    const { adapter, chunks } = makeAdapter()
    const results = [{ id: 'dsh-1', url: 'https://a.com/x', title: 'A', content: 'a' }]
    adapter.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('c1'), name: 'web_search', arguments: '{}' })
    )
    adapter.handleEvent(
      envelope('tool/result', {
        turn: 1,
        step: 1,
        message: toolResultMessage('c1', [{ type: 'text', text: JSON.stringify(results) }])
      })
    )

    expect(chunks.at(-1)).toMatchObject({ type: 'tool-output-available', output: results })
  })

  it('reports the MCP identity behind a bridged tool wire name', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(
      envelope('tool/call', {
        turn: 1,
        step: 1,
        callId: callId('c1'),
        name: 'mcp__cherry-tools__web_search',
        arguments: '{}'
      })
    )

    expect(chunks[0]).toMatchObject({
      providerMetadata: {
        cherry: { tool: { type: 'mcp', name: 'web_search', serverId: 'cherry-tools', serverName: 'cherry-tools' } }
      }
    })
  })

  it('keeps a mixed-content tool result as MCP content blocks', () => {
    const { adapter, chunks } = makeAdapter()
    const content: ContentBlock[] = [
      { type: 'text', text: '{"ok":true}' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'att-1' as ImageBlock['attachment']['attachmentId'],
          mediaType: 'image/png',
          bytes: 4,
          width: 1,
          height: 1
        }
      }
    ]
    adapter.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('c1'), name: 'screenshot', arguments: '{}' })
    )
    adapter.handleEvent(envelope('tool/result', { turn: 1, step: 1, message: toolResultMessage('c1', content) }))

    expect(chunks.at(-1)).toMatchObject({ type: 'tool-output-available', output: content })
  })

  it('degrades malformed tool arguments JSON to an empty input', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('c1'), name: 'edit', arguments: '{oops' })
    )

    expect(chunks[1]).toMatchObject({ type: 'tool-input-available', input: {} })
  })

  it('maps a failed tool result to tool-output-error', () => {
    const { adapter, chunks } = makeAdapter()
    adapter.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('c1'), name: 'bash', arguments: '{}' })
    )
    adapter.handleEvent(
      envelope('tool/result', {
        turn: 1,
        step: 1,
        message: toolResultMessage('c1', [{ type: 'text', text: 'boom' }], true),
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
        message: assistantMessage('m-1'),
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 1 }
      })
    )
    adapter.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 2,
        message: assistantMessage('m-1'),
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
      adapter.handleEvent(
        chunkEnvelope(1, 1, { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'hm' } })
      )
      vi.advanceTimersByTime(100)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'text-delta', index: 1, text: 'answer' }))
      vi.advanceTimersByTime(100)
      adapter.handleEvent(
        envelope('assistant/message', {
          turn: 1,
          step: 1,
          usage: { inputTokens: 10, outputTokens: 5 },
          message: assistantMessage()
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

  it('starts provider timing at step/start before the first streamed chunk', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const { adapter, onAssistantUsage } = makeAdapter()
      adapter.beginTurn()
      adapter.handleEvent(envelope('turn/start', { turn: 1 }))
      adapter.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
      vi.advanceTimersByTime(400)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
      vi.advanceTimersByTime(50)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'text-delta', index: 0, text: 'answer' }))
      vi.advanceTimersByTime(50)
      adapter.handleEvent(chunkEnvelope(1, 1, { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }))
      adapter.handleEvent(
        envelope('assistant/message', {
          turn: 1,
          step: 1,
          usage: { inputTokens: 10, outputTokens: 5 },
          message: assistantMessage()
        })
      )

      expect(onAssistantUsage).toHaveBeenCalledOnce()
      expect(onAssistantUsage.mock.calls[0][0].metrics).toEqual({
        timeFirstTokenMs: 450,
        timeCompletionMs: 500
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('records failed retry attempts and deduplicates the successful terminal usage chunk', () => {
    const { adapter, chunks, onAssistantUsage } = makeAdapter()
    adapter.beginTurn()
    adapter.handleEvent(envelope('turn/start', { turn: 1 }))
    adapter.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
    adapter.handleEvent(chunkEnvelope(1, 1, { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }))
    adapter.handleEvent(
      envelope('llm/retry', {
        retryId: 'r-1' as DshRetryId,
        turn: 1,
        step: 1,
        provider: 'deepseek',
        mode: 'normal',
        policyKey: 'k',
        retry: 1,
        maxRetries: 2,
        delayMs: 0,
        failure: { message: 'rate limited', code: 'RATE_LIMIT', status: 429 }
      })
    )
    adapter.handleEvent(envelope('llm/retry-started', { retryId: 'r-1' as DshRetryId, turn: 1, step: 1, retry: 1 }))
    adapter.handleEvent(chunkEnvelope(1, 1, { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } }))
    adapter.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 1,
        usage: { inputTokens: 20, outputTokens: 5 },
        message: assistantMessage('deepseek-chat')
      })
    )

    expect(onAssistantUsage).toHaveBeenCalledTimes(2)
    expect(onAssistantUsage.mock.calls.map((call) => call[0].usage)).toEqual([
      expect.objectContaining({ inputTokens: 10, outputTokens: 1 }),
      expect.objectContaining({ inputTokens: 20, outputTokens: 5 })
    ])
    expect(chunks.filter((chunk) => chunk.type === 'message-metadata')).toEqual([
      expect.objectContaining({ messageMetadata: expect.objectContaining({ totalTokens: 25 }) })
    ])
  })

  it('records terminal usage when the final provider attempt fails', () => {
    const { adapter, onAssistantUsage } = makeAdapter()
    adapter.beginTurn()
    adapter.handleEvent(envelope('turn/start', { turn: 2 }))
    adapter.handleEvent(envelope('step/start', { turn: 2, step: 1 }))
    adapter.handleEvent(chunkEnvelope(2, 1, { type: 'usage', usage: { inputTokens: 30, outputTokens: 2 } }))
    adapter.handleEvent(envelope('step/end', { turn: 2, step: 1 }))
    adapter.handleEvent(
      envelope('turn/end', {
        turn: 2,
        reason: { kind: 'error', error: { message: 'provider failed', code: 'UNKNOWN' } }
      })
    )

    expect(onAssistantUsage).toHaveBeenCalledOnce()
    expect(onAssistantUsage.mock.calls[0][0].usage).toMatchObject({ inputTokens: 30, outputTokens: 2 })
  })

  it('omits metrics when no chunk streamed before the assistant message', () => {
    const { adapter, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
        message: assistantMessage()
      })
    )
    expect(onAssistantUsage).toHaveBeenCalledTimes(1)
    expect(onAssistantUsage.mock.calls[0][0].metrics).toBeUndefined()
  })

  it('ignores unknown and lifecycle-only events', () => {
    const { adapter, chunks, onTurnEnd } = makeAdapter()
    adapter.handleEvent(envelope('todo/write', { todos: [] }))
    adapter.handleEvent(rawEvent('approval/asked', { toolName: 'bash' }))
    adapter.handleEvent(rawEvent('request/header', { header: {} }))
    adapter.handleEvent(rawEvent('compaction/prune', { shadowedTokenCount: 512 }))
    adapter.handleEvent(rawEvent('some/future-event', { anything: true }))

    expect(chunks).toHaveLength(0)
    expect(onTurnEnd).not.toHaveBeenCalled()
  })

  it('maps a compaction fold to start + complete with region-scope anchor metrics', () => {
    const { adapter, chunks, onCompaction, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-1' as DshCompactionId, turn: 3 }))
    adapter.handleEvent(
      envelope('compaction/summary', {
        compactionId: 'comp-1' as DshCompactionId,
        summary: [{ type: 'text', text: '<compacted-summary>…</compacted-summary>' }],
        shadowedRange: { start: 2, end: 10 },
        shadowedSeqs: [2, 6, 10],
        shadowedTokenCount: 42_000,
        provider: 'deepseek',
        model: 'deepseek-chat',
        usage: { inputTokens: 50_000, outputTokens: 1_800 }
      })
    )
    adapter.handleEvent(envelope('compaction/end', { compactionId: 'comp-1' as DshCompactionId, turn: 3 }))

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
    adapter.handleEvent(
      envelope('compaction/start', {
        compactionId: 'comp-m' as DshCompactionId,
        sourceCommandId: 'cmd-1' as DshCommandId,
        turn: null
      })
    )
    adapter.handleEvent(
      envelope('compaction/end', {
        compactionId: 'comp-m' as DshCompactionId,
        sourceCommandId: 'cmd-1' as DshCommandId,
        turn: null
      })
    )

    expect(onCompaction.mock.calls[0][0]).toEqual({ type: 'compaction-start', trigger: 'manual' })
    expect(onCompaction.mock.calls[1][0].anchor).toMatchObject({ status: 'done', trigger: 'manual' })
  })

  it('maps a failed compaction to a non-terminal compaction-error', () => {
    const { adapter, onCompaction } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-2' as DshCompactionId, turn: 1 }))
    adapter.handleEvent(
      envelope('compaction/end', { compactionId: 'comp-2' as DshCompactionId, turn: 1, error: 'summary failed' })
    )

    expect(onCompaction.mock.calls.map((call) => call[0].type)).toEqual(['compaction-start', 'compaction-error'])
    expect(onCompaction.mock.calls[1][0]).toEqual({ type: 'compaction-error', error: 'summary failed' })
  })

  it('settles a summary-less fold with a metric-free anchor and no usage record', () => {
    const { adapter, onCompaction, onAssistantUsage } = makeAdapter()
    adapter.handleEvent(envelope('compaction/start', { compactionId: 'comp-3' as DshCompactionId, turn: 2 }))
    adapter.handleEvent(envelope('compaction/end', { compactionId: 'comp-3' as DshCompactionId, turn: 2 }))

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
        retryId: 'r-1' as DshRetryId,
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
