/**
 * Child spans for one dsh connection, derived from its session events.
 *
 * dsh runs the provider call inside its own process, so — unlike pi, which wraps
 * the stream call directly — the event log is the only seam: `step/start` →
 * `assistant/message` is one model request, `tool/call` → `tool/result` is one
 * tool execution, and `compaction/start` → `compaction/end` is the summarization
 * request the agent loop never sees. All of them hang off the host's per-session
 * trace root.
 */
// The dsh-compaction-basic / dsh-llm-retry / dsh-user-approval imports load their SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-compaction-basic'
import type { CallId, TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { loggerService } from '@logger'
import { endAgentRuntimeSpan, startAgentRuntimeChildSpan } from '@main/ai/observability'
import { type Attributes, type Span, SpanKind, SpanStatusCode } from '@opentelemetry/api'

import type { AgentRuntimeTraceContext } from '../types'

const logger = loggerService.withContext('DshTrace')

/**
 * A tool call awaiting its span. dsh appends `tool/call` BEFORE the approval
 * gate runs, so the span starts at the approval decision — otherwise a user
 * thinking for a minute reads as a minute of tool execution.
 */
interface PendingToolCall {
  name: string
  startTime: number
  approvalWaitMs?: number
}

export class DshTraceRecorder {
  /** `${turn}:${step}` → provider span. */
  private readonly stepSpans = new Map<string, Span>()
  private readonly pendingTools = new Map<CallId, PendingToolCall>()
  /** approvalId → callId; `approval/decided` carries only the approval identity. */
  private readonly approvalCalls = new Map<ApprovalRequestId, CallId>()
  private readonly compactionSpans = new Map<string, Span>()

  constructor(
    private readonly getContext: () => AgentRuntimeTraceContext | undefined,
    private readonly route: { provider: string; model: string }
  ) {}

  handleEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'step/start':
        return this.startStepSpan(stepKey(event.data))
      case 'assistant/message':
        return this.endStepSpan(stepKey(event.data), event.data)
      case 'step/end':
        // A step whose model request failed emits no assistant/message.
        return this.failStepSpan(stepKey(event.data))
      case 'llm/retry':
        // Retries happen inside the step, so the span covers every attempt.
        return this.recordRetry(stepKey(event.data), event.data)
      case 'tool/call':
        return this.trackToolCall(event.data)
      case 'approval/asked':
        return this.trackApprovalAsked(event.data)
      case 'approval/decided':
        return this.trackApprovalDecided(event.data)
      case 'tool/result':
        return this.endToolSpan(event.data)
      case 'compaction/start':
        return this.startCompactionSpan(event.data)
      case 'compaction/summary':
        return this.annotateCompactionSpan(event.data)
      case 'compaction/end':
        return this.endCompactionSpan(event.data)
      case 'turn/end':
        // A standalone compaction outlives the turn; only close() settles those.
        return this.endTurnSpans('dsh turn ended')
      default:
        return
    }
  }

  close(message: string): void {
    this.endTurnSpans(message)
    for (const span of this.compactionSpans.values()) endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message })
    this.compactionSpans.clear()
  }

  private endTurnSpans(message: string): void {
    for (const span of this.stepSpans.values()) endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message })
    this.stepSpans.clear()
    for (const [toolCallId, pending] of this.pendingTools) {
      this.emitToolSpan(toolCallId, pending, { code: SpanStatusCode.ERROR, message })
    }
    this.pendingTools.clear()
    this.approvalCalls.clear()
  }

  private startStepSpan(key: string): void {
    const previous = this.stepSpans.get(key)
    if (previous) endAgentRuntimeSpan(previous, { code: SpanStatusCode.ERROR, message: 'duplicate dsh step start' })
    this.stepSpans.delete(key)
    const span = startAgentRuntimeChildSpan(this.getContext(), 'dsh.generate_content', SpanKind.CLIENT, {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': this.route.provider,
      'gen_ai.request.model': this.route.model
    })
    if (span) this.stepSpans.set(key, span)
  }

  private endStepSpan(key: string, data: SessionEventMap['assistant/message']): void {
    const span = this.stepSpans.get(key)
    if (!span) return
    this.stepSpans.delete(key)
    try {
      const responseModel = data.message.source.model?.trim()
      if (responseModel) span.setAttribute('gen_ai.response.model', responseModel)
      applyUsageAttributes(span, data.usage)
    } catch (error) {
      logger.warn('Failed to annotate dsh provider span', { error })
    }
    endAgentRuntimeSpan(span, { code: SpanStatusCode.OK })
  }

  private failStepSpan(key: string): void {
    const span = this.stepSpans.get(key)
    if (!span) return
    this.stepSpans.delete(key)
    endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message: 'dsh step ended without a model response' })
  }

  /** A failed attempt leaves no other mark: the step span covers the whole retry sequence. */
  private recordRetry(key: string, data: SessionEventMap['llm/retry']): void {
    const span = this.stepSpans.get(key)
    if (!span) return
    span.addEvent('llm.retry', {
      'cs.retry.attempt': data.retry,
      'cs.retry.delay_ms': data.delayMs,
      'error.type': data.failure.code
    })
  }

  private trackToolCall(data: SessionEventMap['tool/call']): void {
    if (this.pendingTools.has(data.callId)) return
    this.pendingTools.set(data.callId, { name: data.name, startTime: Date.now() })
  }

  private trackApprovalAsked(data: SessionEventMap['approval/asked']): void {
    if (data.callId === undefined || !this.pendingTools.has(data.callId)) return
    this.approvalCalls.set(data.id, data.callId)
  }

  /** Execution begins at the decision — restart the pending call's clock there. */
  private trackApprovalDecided(data: SessionEventMap['approval/decided']): void {
    const toolCallId = this.approvalCalls.get(data.id)
    if (toolCallId === undefined) return
    this.approvalCalls.delete(data.id)
    const pending = this.pendingTools.get(toolCallId)
    if (!pending) return
    const decidedAt = Date.now()
    this.pendingTools.set(toolCallId, {
      ...pending,
      startTime: decidedAt,
      approvalWaitMs: decidedAt - pending.startTime
    })
  }

  private endToolSpan(data: SessionEventMap['tool/result']): void {
    const block = data.message.content.find((entry) => entry.type === 'tool-result')
    if (!block) return
    const pending = this.pendingTools.get(block.toolCallId)
    if (!pending) return
    this.pendingTools.delete(block.toolCallId)
    const failed = data.error !== undefined || block.isError === true
    this.emitToolSpan(
      block.toolCallId,
      pending,
      failed ? { code: SpanStatusCode.ERROR, message: `${pending.name} failed` } : { code: SpanStatusCode.OK }
    )
  }

  private emitToolSpan(
    toolCallId: CallId,
    pending: PendingToolCall,
    status: { code: SpanStatusCode; message?: string }
  ): void {
    const span = startAgentRuntimeChildSpan(
      this.getContext(),
      'dsh.execute_tool',
      SpanKind.INTERNAL,
      {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': pending.name,
        'gen_ai.tool.call.id': toolCallId,
        ...(pending.approvalWaitMs !== undefined ? { 'cs.approval_wait_ms': pending.approvalWaitMs } : {})
      },
      { startTime: pending.startTime }
    )
    if (span) endAgentRuntimeSpan(span, status)
  }

  /** The summarization request the agent loop never sees: no step, no assistant/message. */
  private startCompactionSpan(data: SessionEventMap['compaction/start']): void {
    if (this.compactionSpans.has(data.compactionId)) return
    const span = startAgentRuntimeChildSpan(this.getContext(), 'dsh.compact_context', SpanKind.CLIENT, {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': this.route.provider,
      'gen_ai.request.model': this.route.model
    })
    if (span) this.compactionSpans.set(data.compactionId, span)
  }

  private annotateCompactionSpan(data: SessionEventMap['compaction/summary']): void {
    const span = this.compactionSpans.get(data.compactionId)
    if (!span) return
    try {
      if (data.provider) span.setAttribute('gen_ai.provider.name', data.provider)
      if (data.model) span.setAttribute('gen_ai.response.model', data.model)
      span.setAttribute('cs.compaction_shadowed_tokens', data.shadowedTokenCount)
      applyUsageAttributes(span, data.usage)
    } catch (error) {
      logger.warn('Failed to annotate dsh compaction span', { error })
    }
  }

  private endCompactionSpan(data: SessionEventMap['compaction/end']): void {
    const span = this.compactionSpans.get(data.compactionId)
    if (!span) return
    this.compactionSpans.delete(data.compactionId)
    endAgentRuntimeSpan(
      span,
      data.error ? { code: SpanStatusCode.ERROR, message: data.error } : { code: SpanStatusCode.OK }
    )
  }
}

/** dsh token counts are DISJOINT: billed input = input + cacheRead + cacheWrite. */
function applyUsageAttributes(span: Span, usage: TokenUsage | undefined): void {
  if (!usage) return
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const attributes: Attributes = {
    'gen_ai.usage.input_tokens': usage.inputTokens + cacheReadTokens + cacheWriteTokens,
    'gen_ai.usage.output_tokens': usage.outputTokens,
    'gen_ai.usage.cache_read_tokens': cacheReadTokens,
    'gen_ai.usage.cache_write_tokens': cacheWriteTokens,
    ...(usage.reasoningTokens !== undefined ? { 'gen_ai.usage.reasoning_tokens': usage.reasoningTokens } : {})
  }
  span.setAttributes(attributes)
}

function stepKey(data: { turn: number; step: number }): string {
  return `${data.turn}:${data.step}`
}
