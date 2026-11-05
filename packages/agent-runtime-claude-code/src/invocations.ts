import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeInvocation } from './types'

type InvocationUsage = NonNullable<ClaudeInvocation['usage']>

type InvocationTiming = {
  streamStartedAt: number
  ttftMs?: SDKPartialAssistantMessage['ttft_ms']
  thinkingStartedAt?: number
  thinkingDurationMs?: number
}

type PendingInvocationUsage = Pick<SDKAssistantMessage['message'], 'id' | 'model'> & {
  startUsage?: InvocationUsage
  assistantUsage?: InvocationUsage
  terminalUsage?: InvocationUsage
  timing?: InvocationTiming
  metrics?: ClaudeInvocation['metrics']
  completionObserved: boolean
  isStreamStopped: boolean
}

function invocationUsage(usage: InvocationUsage): InvocationUsage | undefined {
  const reportedValues = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens
  ].filter((value): value is number => value != null)
  if (reportedValues.length === 0 || reportedValues.some((value) => !Number.isFinite(value) || value < 0))
    return undefined

  return { ...usage }
}

function mergeInvocationUsage(
  current: InvocationUsage | undefined,
  next: InvocationUsage | undefined
): InvocationUsage | undefined {
  if (!current) return next
  if (!next) return current
  return {
    ...current,
    ...next,
    output_tokens: next.output_tokens ?? current.output_tokens,
    input_tokens: next.input_tokens ?? current.input_tokens,
    cache_read_input_tokens: next.cache_read_input_tokens ?? current.cache_read_input_tokens,
    cache_creation_input_tokens: next.cache_creation_input_tokens ?? current.cache_creation_input_tokens
  }
}

function pendingInvocationFromAssistant(message: SDKAssistantMessage, fallbackModel: string): PendingInvocationUsage {
  const isComplete = message.message.stop_reason != null && message.aborted !== true && message.error === undefined
  const assistantUsage = isComplete ? invocationUsage(message.message.usage) : undefined
  return {
    id: message.message.id,
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
  current: InvocationUsage | undefined,
  next: InvocationUsage | undefined
): InvocationUsage | undefined {
  if (!next) return current
  if (!current || (next.output_tokens ?? 0) >= (current.output_tokens ?? 0)) return next
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
  const startUsage = mergeInvocationUsage(current.startUsage, next.startUsage)
  const assistantUsage = selectAssistantUsage(current.assistantUsage, next.assistantUsage)
  const terminalUsage = mergeInvocationUsage(current.terminalUsage, next.terminalUsage)
  const timing = next.timing ?? current.timing
  const metrics = next.metrics ?? current.metrics
  return {
    id: current.id,
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
    if (this.pendingInvocations.get(next.id)?.isStreamStopped) {
      this.commitInvocationUsage(next.id)
    }
  }

  private captureStreamInvocation(message: SDKPartialAssistantMessage): void {
    const lane = this.invocationLane(message.parent_tool_use_id)
    if (message.event.type === 'message_start') {
      const sdkMessage = message.event.message
      const startUsage = invocationUsage(sdkMessage.usage)
      const ttftMs = finiteNonnegativeDuration(message.ttft_ms)
      this.captureInvocationForLane(lane, {
        id: sdkMessage.id,
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
      const terminalUsage = invocationUsage(message.event.usage)
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
    if (this.committedInvocationIds.has(next.id)) {
      return
    }

    const previousRequestId = this.streamInvocationIdsByLane.get(lane)
    if (previousRequestId && previousRequestId !== next.id) {
      this.commitInvocationUsage(previousRequestId)
    }
    this.streamInvocationIdsByLane.set(lane, next.id)

    const current = this.pendingInvocations.get(next.id)
    this.pendingInvocations.set(next.id, current ? mergePendingInvocation(current, next) : next)
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
    this.committedInvocationIds.add(pending.id)
    const usage = mergeInvocationUsage(
      mergeInvocationUsage(pending.startUsage, pending.assistantUsage),
      pending.terminalUsage
    )
    this.emitted.push({
      responseId: pending.id,
      ...(pending.model ? { model: pending.model } : {}),
      ...(usage ? { usage } : {}),
      ...(pending.metrics ? { metrics: pending.metrics } : {})
    })
  }

  private invocationLane(parentToolUseId: string | null | undefined): string {
    return parentToolUseId == null ? 'top-level' : `tool:${parentToolUseId}`
  }
}
