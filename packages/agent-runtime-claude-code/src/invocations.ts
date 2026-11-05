import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeInvocation } from './types'

type InvocationUsageBuckets = {
  outputTokens?: number
  noCacheTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

type InvocationMetricSnapshot = {
  timeFirstTokenMs?: number
  timeCompletionMs?: number
  timeThinkingMs?: number
}

type InvocationTiming = {
  streamStartedAt: number
  ttftMs?: number
  thinkingStartedAt?: number
  thinkingDurationMs?: number
}

type PendingInvocationUsage = {
  requestId: string
  model: string
  startUsage?: InvocationUsageBuckets
  assistantUsage?: InvocationUsageBuckets
  terminalUsage?: InvocationUsageBuckets
  timing?: InvocationTiming
  metrics?: InvocationMetricSnapshot
  completionObserved: boolean
  isStreamStopped: boolean
}

type InvocationUsageInput = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

function invocationUsageBuckets(usage: InvocationUsageInput): InvocationUsageBuckets | undefined {
  const reportedValues = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens
  ].filter((value): value is number => value != null)
  if (reportedValues.length === 0 || reportedValues.some((value) => !Number.isFinite(value) || value < 0))
    return undefined

  return {
    ...(usage.input_tokens != null ? { noCacheTokens: usage.input_tokens } : {}),
    ...(usage.output_tokens != null ? { outputTokens: usage.output_tokens } : {}),
    ...(usage.cache_read_input_tokens != null ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
    ...(usage.cache_creation_input_tokens != null ? { cacheWriteTokens: usage.cache_creation_input_tokens } : {})
  }
}

function mergeInvocationUsageBuckets(
  current: InvocationUsageBuckets | undefined,
  next: InvocationUsageBuckets | undefined
): InvocationUsageBuckets | undefined {
  if (!current) return next
  if (!next) return current
  return {
    outputTokens: next.outputTokens ?? current.outputTokens,
    noCacheTokens: next.noCacheTokens ?? current.noCacheTokens,
    cacheReadTokens: next.cacheReadTokens ?? current.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens ?? current.cacheWriteTokens
  }
}

function materializeInvocationUsage(buckets: InvocationUsageBuckets | undefined) {
  if (!buckets) return undefined
  const noCacheTokens = buckets.noCacheTokens ?? 0
  const cacheReadTokens = buckets.cacheReadTokens ?? 0
  const cacheWriteTokens = buckets.cacheWriteTokens ?? 0
  const inputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens
  const outputTokens = buckets.outputTokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens
  }
}

function pendingInvocationFromAssistant(message: SDKAssistantMessage, fallbackModel: string): PendingInvocationUsage {
  const isComplete = message.message.stop_reason != null && message.aborted !== true && message.error === undefined
  const assistantUsage = isComplete ? invocationUsageBuckets(message.message.usage) : undefined
  return {
    requestId: message.message.id,
    model: resolveSdkInvocationModel(message.message.model, fallbackModel),
    ...(assistantUsage ? { assistantUsage } : {}),
    completionObserved: isComplete,
    isStreamStopped: false
  }
}

function resolveSdkInvocationModel(model: unknown, fallbackModel: string): string {
  return typeof model === 'string' && model.trim() ? model : fallbackModel
}

function selectAssistantUsage(
  current: InvocationUsageBuckets | undefined,
  next: InvocationUsageBuckets | undefined
): InvocationUsageBuckets | undefined {
  if (!next) return current
  if (!current || (next.outputTokens ?? 0) >= (current.outputTokens ?? 0)) return next
  return current
}

function finiteNonnegativeDuration(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

function startsThinking(event: SDKPartialAssistantMessage['event']): boolean {
  return (
    (event.type === 'content_block_start' && event.content_block.type === 'thinking') ||
    (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta')
  )
}

function hasNonReasoningOutput(event: SDKPartialAssistantMessage['event']): boolean {
  if (event.type === 'content_block_delta') {
    return (
      (event.delta.type === 'text_delta' && event.delta.text.length > 0) ||
      (event.delta.type === 'input_json_delta' && event.delta.partial_json.length > 0)
    )
  }
  if (event.type !== 'content_block_start') return false
  return (
    event.content_block.type === 'tool_use' ||
    event.content_block.type === 'server_tool_use' ||
    event.content_block.type === 'mcp_tool_use'
  )
}

function mergePendingInvocation(current: PendingInvocationUsage, next: PendingInvocationUsage): PendingInvocationUsage {
  const startUsage = mergeInvocationUsageBuckets(current.startUsage, next.startUsage)
  const assistantUsage = selectAssistantUsage(current.assistantUsage, next.assistantUsage)
  const terminalUsage = mergeInvocationUsageBuckets(current.terminalUsage, next.terminalUsage)
  const timing = next.timing ?? current.timing
  const metrics = next.metrics ?? current.metrics
  return {
    requestId: current.requestId,
    model: next.model || current.model,
    ...(startUsage ? { startUsage } : {}),
    ...(assistantUsage ? { assistantUsage } : {}),
    ...(terminalUsage ? { terminalUsage } : {}),
    ...(timing ? { timing } : {}),
    ...(metrics ? { metrics } : {}),
    completionObserved: current.completionObserved || next.completionObserved,
    isStreamStopped: current.isStreamStopped || next.isStreamStopped
  }
}

/** SDK response identity owns aggregation, independent of any product billing route. */
export class ClaudeInvocations {
  private readonly pendingInvocations = new Map<string, PendingInvocationUsage>()
  private readonly streamInvocationIdsByLane = new Map<string, string>()
  private readonly committedInvocationIds = new Set<string>()
  private readonly emitted: ClaudeInvocation[] = []

  accept(message: SDKMessage): readonly ClaudeInvocation[] {
    if (message.type === 'assistant') this.captureAssistantInvocation(message)
    else if (message.type === 'stream_event') this.captureStreamInvocation(message)
    else if (
      message.type === 'result' ||
      (message.type === 'system' &&
        (message.subtype === 'task_notification' ||
          (message.subtype === 'task_updated' &&
            ['completed', 'failed', 'stopped', 'killed'].includes(message.patch.status ?? ''))))
    )
      this.commitPendingInvocations()
    return this.emitted.splice(0)
  }

  close(): readonly ClaudeInvocation[] {
    this.settlePendingInvocations()
    return this.emitted.splice(0)
  }

  private captureAssistantInvocation(message: SDKAssistantMessage): void {
    if (this.committedInvocationIds.has(message.message.id)) return

    const next = pendingInvocationFromAssistant(message, '')
    this.captureInvocationForLane(this.invocationLane(message.parent_tool_use_id), next)
    if (this.pendingInvocations.get(next.requestId)?.isStreamStopped) {
      this.commitInvocationUsage(next.requestId)
    }
  }

  private captureStreamInvocation(message: SDKPartialAssistantMessage): void {
    const lane = this.invocationLane(message.parent_tool_use_id)
    if (message.event.type === 'message_start') {
      const sdkMessage = message.event.message
      const startUsage = invocationUsageBuckets(sdkMessage.usage)
      const ttftMs = finiteNonnegativeDuration(message.ttft_ms)
      this.captureInvocationForLane(lane, {
        requestId: sdkMessage.id,
        model: resolveSdkInvocationModel(sdkMessage.model, ''),
        ...(startUsage ? { startUsage } : {}),
        timing: {
          streamStartedAt: performance.now(),
          ...(ttftMs !== undefined ? { ttftMs } : {})
        },
        completionObserved: false,
        isStreamStopped: false
      })
      return
    }

    const requestId = this.streamInvocationIdsByLane.get(lane)
    if (!requestId) return

    if (message.event.type === 'content_block_start' || message.event.type === 'content_block_delta') {
      const current = this.pendingInvocations.get(requestId)
      if (!current) return
      this.pendingInvocations.set(requestId, this.observeInvocationOutput(current, message))
      return
    }

    if (message.event.type === 'message_delta') {
      const current = this.pendingInvocations.get(requestId)
      if (!current) return
      const terminalUsage = invocationUsageBuckets(message.event.usage)
      const isStreamStopped = message.event.delta.stop_reason !== null
      const finalized = isStreamStopped ? this.finalizeInvocationTiming(current) : current
      this.pendingInvocations.set(requestId, {
        ...finalized,
        ...(terminalUsage ? { terminalUsage } : {}),
        completionObserved: finalized.completionObserved || isStreamStopped,
        isStreamStopped: finalized.isStreamStopped || isStreamStopped
      })
      if (isStreamStopped && (terminalUsage || current.terminalUsage)) this.commitInvocationUsage(requestId)
      return
    }

    if (message.event.type === 'message_stop') {
      const current = this.pendingInvocations.get(requestId)
      if (!current) return
      this.pendingInvocations.set(requestId, {
        ...this.finalizeInvocationTiming(current),
        completionObserved: true,
        isStreamStopped: true
      })
      if (current.terminalUsage || current.assistantUsage) this.commitInvocationUsage(requestId)
    }
  }

  private observeInvocationOutput(
    pending: PendingInvocationUsage,
    message: SDKPartialAssistantMessage
  ): PendingInvocationUsage {
    const timing = pending.timing
    if (!timing) return pending

    let thinkingStartedAt = timing.thinkingStartedAt
    let thinkingDurationMs = timing.thinkingDurationMs
    if (startsThinking(message.event) && thinkingStartedAt === undefined) {
      thinkingStartedAt = performance.now()
    }
    if (thinkingStartedAt !== undefined && thinkingDurationMs === undefined && hasNonReasoningOutput(message.event)) {
      thinkingDurationMs = Math.max(0, Math.round(performance.now() - thinkingStartedAt))
    }

    return {
      ...pending,
      timing: {
        ...timing,
        ...(thinkingStartedAt !== undefined ? { thinkingStartedAt } : {}),
        ...(thinkingDurationMs !== undefined ? { thinkingDurationMs } : {})
      }
    }
  }

  private finalizeInvocationTiming(pending: PendingInvocationUsage): PendingInvocationUsage {
    const timing = pending.timing
    if (!timing) return pending

    const completedAt = performance.now()
    const timeFirstTokenMs = timing.ttftMs
    const timeCompletionMs =
      timeFirstTokenMs !== undefined
        ? Math.max(timeFirstTokenMs, Math.round(timeFirstTokenMs + completedAt - timing.streamStartedAt))
        : undefined
    const timeThinkingMs =
      timing.thinkingDurationMs ??
      (timing.thinkingStartedAt !== undefined
        ? Math.max(0, Math.round(completedAt - timing.thinkingStartedAt))
        : undefined)
    const metrics = {
      ...(timeFirstTokenMs !== undefined ? { timeFirstTokenMs } : {}),
      ...(timeCompletionMs !== undefined ? { timeCompletionMs } : {}),
      ...(timeThinkingMs !== undefined ? { timeThinkingMs } : {})
    }

    return {
      ...pending,
      ...(Object.keys(metrics).length > 0 ? { metrics } : {})
    }
  }

  private captureInvocationForLane(lane: string, next: PendingInvocationUsage): void {
    if (this.committedInvocationIds.has(next.requestId)) {
      return
    }

    const previousRequestId = this.streamInvocationIdsByLane.get(lane)
    if (previousRequestId && previousRequestId !== next.requestId) {
      this.commitInvocationUsage(previousRequestId)
    }
    this.streamInvocationIdsByLane.set(lane, next.requestId)

    const current = this.pendingInvocations.get(next.requestId)
    this.pendingInvocations.set(next.requestId, current ? mergePendingInvocation(current, next) : next)
  }

  private commitPendingInvocations(): void {
    for (const requestId of [...this.pendingInvocations.keys()]) {
      this.commitInvocationUsage(requestId)
    }
  }

  private settlePendingInvocations(): void {
    for (const [requestId, pending] of [...this.pendingInvocations.entries()]) {
      if (pending.completionObserved) {
        this.commitInvocationUsage(requestId)
      } else {
        this.discardInvocationUsage(requestId)
      }
    }
  }

  private discardInvocationUsage(requestId: string): void {
    if (!this.pendingInvocations.delete(requestId)) return
    for (const [lane, laneRequestId] of this.streamInvocationIdsByLane) {
      if (laneRequestId === requestId) this.streamInvocationIdsByLane.delete(lane)
    }
  }

  private commitInvocationUsage(requestId: string): void {
    const pending = this.pendingInvocations.get(requestId)
    if (!pending) return
    this.pendingInvocations.delete(requestId)
    for (const [lane, laneRequestId] of this.streamInvocationIdsByLane) {
      if (laneRequestId === requestId) this.streamInvocationIdsByLane.delete(lane)
    }
    this.committedInvocationIds.add(pending.requestId)
    const usage = materializeInvocationUsage(
      mergeInvocationUsageBuckets(
        mergeInvocationUsageBuckets(pending.startUsage, pending.assistantUsage),
        pending.terminalUsage
      )
    )
    this.emitted.push({
      responseId: pending.requestId,
      ...(pending.model ? { model: pending.model } : {}),
      ...(usage ? { usage } : {}),
      ...(pending.metrics ? { metrics: pending.metrics } : {})
    })
  }

  private invocationLane(parentToolUseId: string | null | undefined): string {
    return parentToolUseId == null ? 'top-level' : `tool:${parentToolUseId}`
  }
}
