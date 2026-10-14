import type { MessageRuntimeSpan, MessageRuntimeTiming } from '@shared/data/types/message'

export interface MessageRuntimeTimingSink {
  onToolExecutionStart(event: { callId: string; toolName?: string }): void
  onToolExecutionEnd(event: { callId: string; toolName?: string; durationMs: number }): void
}

function cloneTiming(timing: MessageRuntimeTiming): MessageRuntimeTiming {
  return {
    startedAt: timing.startedAt,
    ...(timing.completedAt !== undefined ? { completedAt: timing.completedAt } : {}),
    spans: timing.spans.map((span) => ({ ...span }))
  }
}

export class MessageRuntimeTimingCollector {
  private readonly timing: MessageRuntimeTiming

  constructor(seed?: MessageRuntimeTiming, startedAt = Date.now()) {
    this.timing = seed ? cloneTiming(seed) : { startedAt, spans: [] }
    // A continuation extends the same message execution.
    delete this.timing.completedAt
  }

  readonly sink: MessageRuntimeTimingSink = {
    onToolExecutionStart: ({ callId, toolName }) => {
      this.startTool(callId, toolName)
    },
    onToolExecutionEnd: ({ callId, toolName, durationMs }) => {
      this.finishTool(callId, durationMs, toolName)
    }
  }

  startTool(toolCallId: string, toolName?: string, startedAt = Date.now()): void {
    const id = `tool:${toolCallId}`
    const existing = this.findSpan(id)
    if (existing) return
    this.timing.spans.push({
      id,
      kind: 'tool-execution',
      toolCallId,
      ...(toolName ? { toolName } : {}),
      startedAt
    })
  }

  finishTool(toolCallId: string, durationMs: number, toolName?: string, completedAt = Date.now()): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return
    const id = `tool:${toolCallId}`
    const existing = this.findSpan(id)
    // The owner-reported duration excludes hook/approval latency. Anchor the
    // final interval at the end hook rather than preserving the provisional
    // start-hook timestamp, which may precede other start hooks.
    const startedAt = completedAt - durationMs
    const resolvedToolName = toolName ?? existing?.toolName
    this.upsertSpan(
      {
        id,
        kind: 'tool-execution',
        toolCallId,
        ...(resolvedToolName ? { toolName: resolvedToolName } : {}),
        startedAt,
        completedAt: Math.max(startedAt, completedAt)
      },
      false
    )
  }

  startApproval(approvalId: string, toolCallId: string, toolName?: string, startedAt = Date.now()): void {
    const id = `approval:${approvalId}`
    if (this.findSpan(id)) return
    this.timing.spans.push({
      id,
      kind: 'approval-wait',
      approvalId,
      toolCallId,
      ...(toolName ? { toolName } : {}),
      startedAt
    })
  }

  finishApproval(identity: { approvalId?: string; toolCallId?: string }, completedAt = Date.now()): boolean {
    const span = this.timing.spans.find(
      (candidate) =>
        candidate.kind === 'approval-wait' &&
        candidate.completedAt === undefined &&
        (identity.approvalId !== undefined
          ? candidate.approvalId === identity.approvalId
          : candidate.toolCallId === identity.toolCallId)
    )
    if (!span) return false
    span.completedAt = Math.max(span.startedAt, completedAt)
    return true
  }

  addCompletedSpan(span: MessageRuntimeSpan): void {
    this.upsertSpan({ ...span })
  }

  closeOpenSpans(completedAt = Date.now()): void {
    for (const span of this.timing.spans) {
      if (span.completedAt === undefined) span.completedAt = Math.max(span.startedAt, completedAt)
    }
  }

  closeOpenToolSpans(completedAt = Date.now()): void {
    for (const span of this.timing.spans) {
      if (span.kind === 'tool-execution' && span.completedAt === undefined) {
        span.completedAt = Math.max(span.startedAt, completedAt)
      }
    }
  }

  complete(completedAt = Date.now()): void {
    this.timing.completedAt = Math.max(this.timing.startedAt, completedAt)
  }

  snapshot(): MessageRuntimeTiming {
    return cloneTiming({
      ...this.timing,
      spans: [...this.timing.spans].sort(
        (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)
      )
    })
  }

  private findSpan(id: string): MessageRuntimeSpan | undefined {
    return this.timing.spans.find((span) => span.id === id)
  }

  private upsertSpan(incoming: MessageRuntimeSpan, shouldPreserveEarliestStart = true): void {
    const index = this.timing.spans.findIndex((span) => span.id === incoming.id)
    if (index < 0) {
      this.timing.spans.push(incoming)
      return
    }
    const existing = this.timing.spans[index]
    if (existing.kind !== incoming.kind) return
    this.timing.spans[index] = {
      ...existing,
      ...incoming,
      startedAt: shouldPreserveEarliestStart ? Math.min(existing.startedAt, incoming.startedAt) : incoming.startedAt
    }
  }
}
