import type {} from '@deepseek-ai/dsh-compaction-basic'
import type { AssistantMessage, CallId, ContentBlock, MessageId, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeTraceContext } from '../../types'
import { DshTraceRecorder } from '../dshTrace'

interface FakeSpan {
  name: string
  options: Record<string, any>
  parent: unknown
  attributes: Record<string, unknown>
  setAttribute: ReturnType<typeof vi.fn>
  setAttributes: ReturnType<typeof vi.fn>
  setStatus: ReturnType<typeof vi.fn>
  addEvent: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const spans: FakeSpan[] = []
const startSpan = vi.fn((name: string, options: Record<string, any>, parent: unknown) => {
  const span: FakeSpan = {
    name,
    options,
    parent,
    attributes: {},
    setAttribute: vi.fn((key: string, value: unknown) => {
      span.attributes[key] = value
    }),
    setAttributes: vi.fn((values: Record<string, unknown>) => {
      Object.assign(span.attributes, values)
    }),
    setStatus: vi.fn(),
    addEvent: vi.fn(),
    end: vi.fn()
  }
  spans.push(span)
  return span
})
vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan } as never)

const traceContext: AgentRuntimeTraceContext = {
  topicId: 'topic-1',
  traceId: 'a'.repeat(32),
  rootSpanId: 'b'.repeat(16),
  sessionId: 'session-1',
  turnId: 'turn-1',
  modelName: 'deepseek-chat'
}

let seq = 0
const envelope = <T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent =>
  ({ type, seq: ++seq, time: 0, data }) as SessionEvent
type DshCompactionId = SessionEventMap['compaction/start']['compactionId']
type DshRetryId = SessionEventMap['llm/retry']['retryId']
const callId = (id: string) => id as CallId
const approvalId = (id: string) => id as ApprovalRequestId
const assistantMessage = (model = 'deepseek-chat-0711'): AssistantMessage => ({
  id: 'msg-1' as MessageId,
  role: 'assistant',
  content: [],
  source: { kind: 'model', provider: 'deepseek', model }
})
const toolResultMessage = (id: string, isError?: boolean): ToolResultMessage => ({
  id: `msg-${id}` as MessageId,
  role: 'user',
  content: [
    {
      type: 'tool-result',
      toolCallId: callId(id),
      content: [] as ContentBlock[],
      ...(isError !== undefined ? { isError } : {})
    }
  ],
  source: { kind: 'tool', callId: callId(id) }
})

function makeRecorder(context?: AgentRuntimeTraceContext) {
  return new DshTraceRecorder(() => context, { provider: 'deepseek', model: 'deepseek-chat' })
}

beforeEach(() => {
  spans.length = 0
  startSpan.mockClear()
})

describe('DshTraceRecorder', () => {
  it('records a provider span parented to the session trace root with disjoint token totals', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
    recorder.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage(),
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 4 }
      })
    )
    recorder.handleEvent(envelope('step/end', { turn: 1, step: 1 }))

    expect(spans).toHaveLength(1)
    const [span] = spans
    expect(span.name).toBe('dsh.generate_content')
    expect(trace.getSpanContext(span.parent as never)).toMatchObject({
      traceId: traceContext.traceId,
      spanId: traceContext.rootSpanId
    })
    expect(span.options.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'deepseek',
      'gen_ai.request.model': 'deepseek-chat',
      'trace.topicId': 'topic-1',
      'cs.agent_session_id': 'session-1',
      'cs.agent_turn_id': 'turn-1'
    })
    expect(span.attributes).toMatchObject({
      'gen_ai.response.model': 'deepseek-chat-0711',
      'gen_ai.usage.input_tokens': 15,
      'gen_ai.usage.output_tokens': 5,
      'gen_ai.usage.cache_read_tokens': 3,
      'gen_ai.usage.cache_write_tokens': 2,
      'gen_ai.usage.reasoning_tokens': 4
    })
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
    expect(span.end).toHaveBeenCalledOnce()
  })

  it('ends a step span in error when the model request produced no message', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
    recorder.handleEvent(envelope('step/end', { turn: 1, step: 1 }))

    expect(spans[0].setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'dsh step ended without a model response'
    })
    expect(spans[0].end).toHaveBeenCalledOnce()
  })

  it('marks provider retries on the step span they happen inside', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
    recorder.handleEvent(
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
        failure: { message: 'server error', code: 'SERVER', status: 500 }
      })
    )
    recorder.handleEvent(
      envelope('assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage(),
        usage: { inputTokens: 1, outputTokens: 1 }
      })
    )

    expect(spans).toHaveLength(1)
    expect(spans[0].addEvent).toHaveBeenCalledWith('llm.retry', {
      'cs.retry.attempt': 1,
      'cs.retry.delay_ms': 500,
      'error.type': 'SERVER'
    })
    expect(spans[0].setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
  })

  it('records one tool span per call and fails the span on an error result', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('call-1'), name: 'bash', arguments: '{}' })
    )
    recorder.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('call-2'), name: 'read', arguments: '{}' })
    )
    recorder.handleEvent(envelope('tool/result', { turn: 1, step: 1, message: toolResultMessage('call-1', true) }))
    recorder.handleEvent(envelope('tool/result', { turn: 1, step: 1, message: toolResultMessage('call-2') }))

    const toolSpans = spans.filter((span) => span.name === 'dsh.execute_tool')
    expect(toolSpans.map((span) => span.options.attributes['gen_ai.tool.name'])).toEqual(['bash', 'read'])
    expect(toolSpans[0].setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'bash failed' })
    expect(toolSpans[1].setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
  })

  it('excludes the approval wait from the tool span (dsh logs tool/call before the gate)', () => {
    vi.useFakeTimers()
    try {
      const recorder = makeRecorder(traceContext)
      const calledAt = Date.now()
      recorder.handleEvent(
        envelope('tool/call', { turn: 1, step: 1, callId: callId('call-1'), name: 'bash', arguments: '{}' })
      )
      recorder.handleEvent(
        envelope('approval/asked', { id: approvalId('ask-1'), toolName: 'bash', callId: callId('call-1') })
      )
      vi.advanceTimersByTime(30_000)
      recorder.handleEvent(envelope('approval/decided', { id: approvalId('ask-1'), outcome: 'allowed-once' }))
      vi.advanceTimersByTime(200)
      recorder.handleEvent(envelope('tool/result', { turn: 1, step: 1, message: toolResultMessage('call-1') }))

      const [span] = spans
      expect(span.options.startTime).toBe(calledAt + 30_000)
      expect(span.options.attributes['cs.approval_wait_ms']).toBe(30_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records the compaction summarization request the agent loop never reports', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('compaction/start', { compactionId: 'c-1' as DshCompactionId, turn: 1 }))
    recorder.handleEvent(
      envelope('compaction/summary', {
        compactionId: 'c-1' as DshCompactionId,
        summary: [{ type: 'text', text: '<compacted-summary>…</compacted-summary>' }],
        shadowedRange: { start: 2, end: 10 },
        shadowedSeqs: [2, 6, 10],
        shadowedTokenCount: 4200,
        provider: 'deepseek',
        model: 'deepseek-chat-0711',
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 }
      })
    )
    recorder.handleEvent(envelope('compaction/end', { compactionId: 'c-1' as DshCompactionId, turn: 1 }))

    expect(spans).toHaveLength(1)
    const [span] = spans
    expect(span.name).toBe('dsh.compact_context')
    expect(span.attributes).toMatchObject({
      'gen_ai.response.model': 'deepseek-chat-0711',
      'cs.compaction_shadowed_tokens': 4200,
      'gen_ai.usage.input_tokens': 110,
      'gen_ai.usage.output_tokens': 20
    })
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
  })

  it('fails the compaction span on a failed compaction', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('compaction/start', { compactionId: 'c-1' as DshCompactionId, turn: null }))
    recorder.handleEvent(
      envelope('compaction/end', { compactionId: 'c-1' as DshCompactionId, turn: null, error: 'summarize failed' })
    )

    expect(spans[0].setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'summarize failed' })
  })

  it('keeps a standalone compaction span open across a turn boundary', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('compaction/start', { compactionId: 'c-1' as DshCompactionId, turn: null }))
    recorder.handleEvent(envelope('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(spans[0].end).not.toHaveBeenCalled()

    recorder.close('dsh connection closed')
    expect(spans[0].setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'dsh connection closed'
    })
  })

  it('closes spans stranded by a turn that ended mid-flight', () => {
    const recorder = makeRecorder(traceContext)
    recorder.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
    recorder.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('call-1'), name: 'bash', arguments: '{}' })
    )
    recorder.handleEvent(envelope('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))

    expect(spans).toHaveLength(2)
    for (const span of spans) {
      expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'dsh turn ended' })
      expect(span.end).toHaveBeenCalledOnce()
    }
  })

  it('starts no spans while the session has no trace context', () => {
    const recorder = makeRecorder()
    recorder.handleEvent(envelope('step/start', { turn: 1, step: 1 }))
    recorder.handleEvent(
      envelope('tool/call', { turn: 1, step: 1, callId: callId('call-1'), name: 'bash', arguments: '{}' })
    )
    recorder.handleEvent(envelope('tool/result', { turn: 1, step: 1, message: toolResultMessage('call-1') }))

    expect(startSpan).not.toHaveBeenCalled()
  })
})
