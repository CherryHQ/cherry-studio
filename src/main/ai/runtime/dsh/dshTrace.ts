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
  private readonly pendingTools = new Map<string, PendingToolCall>()
  /** approvalId → callId; `approval/decided` carries only the approval identity. */
  private readonly approvalCalls = new Map<string, string>()
  private readonly compactionSpans = new Map<string, Span>()

  constructor(
    private readonly getContext: () => AgentRuntimeTraceContext | undefined,
    private readonly route: { provider: string; model: string }
  ) {}

  handleEvent(event: unknown): void {
    if (!isRecord(event) || typeof event.type !== 'string') return
    const data = isRecord(event.data) ? event.data : {}
    switch (event.type) {
      case 'step/start':
        return this.startStepSpan(stepKey(data))
      case 'assistant/message':
        return this.endStepSpan(stepKey(data), data)
      case 'step/end':
        // A step whose model request failed emits no assistant/message.
        return this.failStepSpan(stepKey(data))
      case 'llm/retry':
        // Retries happen inside the step, so the span covers every attempt.
        return this.recordRetry(stepKey(data), data)
      case 'tool/call':
        return this.trackToolCall(data)
      case 'approval/asked':
        return this.trackApprovalAsked(data)
      case 'approval/decided':
        return this.trackApprovalDecided(data)
      case 'tool/result':
        return this.endToolSpan(data)
      case 'compaction/start':
        return this.startCompactionSpan(data)
      case 'compaction/summary':
        return this.annotateCompactionSpan(data)
      case 'compaction/end':
        return this.endCompactionSpan(data)
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

  private endStepSpan(key: string, data: Record<string, unknown>): void {
    const span = this.stepSpans.get(key)
    if (!span) return
    this.stepSpans.delete(key)
    try {
      const message = isRecord(data.message) ? data.message : undefined
      const source = message && isRecord(message.source) ? message.source : undefined
      const responseModel = typeof source?.model === 'string' ? source.model.trim() : ''
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
  private recordRetry(key: string, data: Record<string, unknown>): void {
    const span = this.stepSpans.get(key)
    if (!span) return
    const failure = isRecord(data.failure) ? data.failure : {}
    span.addEvent('llm.retry', {
      'cs.retry.attempt': numeric(data.retry),
      'cs.retry.delay_ms': numeric(data.delayMs),
      'error.type': typeof failure.code === 'string' ? failure.code : 'UNKNOWN'
    })
  }

  private trackToolCall(data: Record<string, unknown>): void {
    const toolCallId = String(data.callId ?? '')
    if (!toolCallId || this.pendingTools.has(toolCallId)) return
    this.pendingTools.set(toolCallId, { name: String(data.name ?? 'unknown'), startTime: Date.now() })
  }

  private trackApprovalAsked(data: Record<string, unknown>): void {
    const approvalId = String(data.id ?? '')
    const toolCallId = String(data.callId ?? '')
    if (!approvalId || !this.pendingTools.has(toolCallId)) return
    this.approvalCalls.set(approvalId, toolCallId)
  }

  /** Execution begins at the decision — restart the pending call's clock there. */
  private trackApprovalDecided(data: Record<string, unknown>): void {
    const approvalId = String(data.id ?? '')
    const toolCallId = this.approvalCalls.get(approvalId)
    if (!toolCallId) return
    this.approvalCalls.delete(approvalId)
    const pending = this.pendingTools.get(toolCallId)
    if (!pending) return
    const decidedAt = Date.now()
    this.pendingTools.set(toolCallId, {
      ...pending,
      startTime: decidedAt,
      approvalWaitMs: decidedAt - pending.startTime
    })
  }

  private endToolSpan(data: Record<string, unknown>): void {
    const message = isRecord(data.message) ? data.message : {}
    const block = Array.isArray(message.content) && isRecord(message.content[0]) ? message.content[0] : undefined
    const toolCallId = String(block?.toolCallId ?? '')
    const pending = this.pendingTools.get(toolCallId)
    if (!pending) return
    this.pendingTools.delete(toolCallId)
    const failed = data.error !== undefined || block?.isError === true
    this.emitToolSpan(
      toolCallId,
      pending,
      failed ? { code: SpanStatusCode.ERROR, message: `${pending.name} failed` } : { code: SpanStatusCode.OK }
    )
  }

  private emitToolSpan(
    toolCallId: string,
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
  private startCompactionSpan(data: Record<string, unknown>): void {
    const compactionId = String(data.compactionId ?? '')
    if (!compactionId || this.compactionSpans.has(compactionId)) return
    const span = startAgentRuntimeChildSpan(this.getContext(), 'dsh.compact_context', SpanKind.CLIENT, {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': this.route.provider,
      'gen_ai.request.model': this.route.model
    })
    if (span) this.compactionSpans.set(compactionId, span)
  }

  private annotateCompactionSpan(data: Record<string, unknown>): void {
    const span = this.compactionSpans.get(String(data.compactionId ?? ''))
    if (!span) return
    try {
      if (typeof data.provider === 'string' && data.provider) span.setAttribute('gen_ai.provider.name', data.provider)
      if (typeof data.model === 'string' && data.model) span.setAttribute('gen_ai.response.model', data.model)
      span.setAttribute('cs.compaction_shadowed_tokens', numeric(data.shadowedTokenCount))
      applyUsageAttributes(span, data.usage)
    } catch (error) {
      logger.warn('Failed to annotate dsh compaction span', { error })
    }
  }

  private endCompactionSpan(data: Record<string, unknown>): void {
    const compactionId = String(data.compactionId ?? '')
    const span = this.compactionSpans.get(compactionId)
    if (!span) return
    this.compactionSpans.delete(compactionId)
    const error = typeof data.error === 'string' ? data.error : undefined
    endAgentRuntimeSpan(span, error ? { code: SpanStatusCode.ERROR, message: error } : { code: SpanStatusCode.OK })
  }
}

/** dsh token counts are DISJOINT: billed input = input + cacheRead + cacheWrite. */
function applyUsageAttributes(span: Span, rawUsage: unknown): void {
  if (!isRecord(rawUsage)) return
  const cacheReadTokens = numeric(rawUsage.cacheReadTokens)
  const cacheWriteTokens = numeric(rawUsage.cacheWriteTokens)
  const attributes: Attributes = {
    'gen_ai.usage.input_tokens': numeric(rawUsage.inputTokens) + cacheReadTokens + cacheWriteTokens,
    'gen_ai.usage.output_tokens': numeric(rawUsage.outputTokens),
    'gen_ai.usage.cache_read_tokens': cacheReadTokens,
    'gen_ai.usage.cache_write_tokens': cacheWriteTokens,
    ...(rawUsage.reasoningTokens !== undefined
      ? { 'gen_ai.usage.reasoning_tokens': numeric(rawUsage.reasoningTokens) }
      : {})
  }
  span.setAttributes(attributes)
}

function stepKey(data: Record<string, unknown>): string {
  return `${numeric(data.turn)}:${numeric(data.step)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
