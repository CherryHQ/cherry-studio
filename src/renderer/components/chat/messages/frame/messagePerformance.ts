import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'
import type { MessageRuntimeSpan, MessageStats } from '@shared/data/types/message'

export type MessagePerformanceLaneId = 'model' | 'tool' | 'approval' | 'other'

export interface MessagePerformanceInterval {
  id: string
  lane: MessagePerformanceLaneId
  label?: string
  startedAt: number
  completedAt: number
}

export interface MessagePerformanceViewModel {
  startedAt?: number
  completedAt?: number
  totalDurationMs?: number
  timeFirstTokenMs?: number
  modelTokensPerSecond?: number
  endToEndTokensPerSecond?: number
  intervals: MessagePerformanceInterval[]
}

export function getMessageTokenUsage(stats: MessageStats) {
  const inputTokens = stats.inputTokens
  const outputTokens = stats.outputTokens
  const componentTotal =
    inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined
  const totalTokens = stats.totalTokens !== undefined && stats.totalTokens > 0 ? stats.totalTokens : componentTotal

  if (![inputTokens, outputTokens, totalTokens].some((value) => value !== undefined && value > 0)) return {}
  return { inputTokens, outputTokens, totalTokens }
}

function intervalFromRuntimeSpan(span: MessageRuntimeSpan, rangeEnd: number): MessagePerformanceInterval | undefined {
  const completedAt = span.completedAt ?? rangeEnd
  if (completedAt <= span.startedAt) return undefined
  return {
    id: span.id,
    lane: span.kind === 'tool-execution' ? 'tool' : 'approval',
    label: span.toolName ?? (span.kind === 'tool-execution' ? span.toolCallId : span.approvalId),
    startedAt: span.startedAt,
    completedAt
  }
}

function complementIntervals(
  startedAt: number,
  completedAt: number,
  measured: readonly MessagePerformanceInterval[]
): MessagePerformanceInterval[] {
  const merged: Array<{ startedAt: number; completedAt: number }> = []
  for (const interval of [...measured].sort((left, right) => left.startedAt - right.startedAt)) {
    const clipped = {
      startedAt: Math.max(startedAt, interval.startedAt),
      completedAt: Math.min(completedAt, interval.completedAt)
    }
    if (clipped.completedAt <= clipped.startedAt) continue
    const tail = merged.at(-1)
    if (tail && clipped.startedAt <= tail.completedAt) {
      tail.completedAt = Math.max(tail.completedAt, clipped.completedAt)
    } else {
      merged.push(clipped)
    }
  }

  const gaps: MessagePerformanceInterval[] = []
  let cursor = startedAt
  for (const interval of merged) {
    if (interval.startedAt > cursor) {
      gaps.push({
        id: `other:${gaps.length}`,
        lane: 'other',
        startedAt: cursor,
        completedAt: interval.startedAt
      })
    }
    cursor = Math.max(cursor, interval.completedAt)
  }
  if (cursor < completedAt) {
    gaps.push({
      id: `other:${gaps.length}`,
      lane: 'other',
      startedAt: cursor,
      completedAt
    })
  }
  return gaps
}

function buildRuntimeViewModel(
  stats: MessageStats,
  records: readonly AiUsageRecordEntry[],
  now: number
): MessagePerformanceViewModel {
  const runtime = stats.runtimeTiming!
  const rangeEnd = runtime.completedAt ?? now
  const runtimeIntervals = runtime.spans
    .map((span) => intervalFromRuntimeSpan(span, rangeEnd))
    .filter((span): span is MessagePerformanceInterval => span !== undefined)

  const modelIntervals: MessagePerformanceInterval[] = []
  for (const record of records) {
    if (record.recordKind !== 'invocation') continue
    const completedAt = Date.parse(record.createdAt)
    const fullDurationMs = record.timeCompletionMs ?? undefined
    const startedAt =
      Number.isFinite(completedAt) && fullDurationMs !== undefined ? completedAt - fullDurationMs : undefined
    const label = record.modelName ?? record.modelId ?? record.providerName ?? record.providerId ?? record.modality
    if (startedAt !== undefined && completedAt > startedAt) {
      modelIntervals.push({
        id: record.id,
        lane: 'model',
        label,
        startedAt,
        completedAt
      })
    }
  }

  const measuredOutputTokens = stats.providerPerformance?.measuredOutputTokens
  const generationDuration = stats.providerPerformance?.generationDurationMs
  const firstTokenRecord = records.find(
    (record) => record.recordKind === 'invocation' && record.timeFirstTokenMs !== null
  )
  const timeFirstTokenMs = firstTokenRecord?.timeFirstTokenMs ?? undefined
  const modelTokensPerSecond =
    measuredOutputTokens !== undefined &&
    measuredOutputTokens > 0 &&
    generationDuration !== undefined &&
    generationDuration > 0
      ? measuredOutputTokens / (generationDuration / 1000)
      : undefined
  const totalDurationMs =
    runtime.completedAt !== undefined ? Math.max(0, runtime.completedAt - runtime.startedAt) : undefined
  const outputTokens = getMessageTokenUsage(stats).outputTokens
  const endToEndTokensPerSecond =
    totalDurationMs !== undefined && totalDurationMs > 0 && outputTokens !== undefined && outputTokens > 0
      ? outputTokens / (totalDurationMs / 1000)
      : undefined
  const measuredIntervals = [...modelIntervals, ...runtimeIntervals]

  return {
    startedAt: runtime.startedAt,
    completedAt: rangeEnd,
    totalDurationMs,
    ...(timeFirstTokenMs !== undefined ? { timeFirstTokenMs } : {}),
    modelTokensPerSecond,
    endToEndTokensPerSecond,
    intervals: [...measuredIntervals, ...complementIntervals(runtime.startedAt, rangeEnd, measuredIntervals)]
  }
}

function buildLegacyViewModel(stats: MessageStats): MessagePerformanceViewModel {
  const completion = stats.timeCompletionMs
  if (completion === undefined || completion <= 0) return { intervals: [] }

  const firstToken = Math.min(Math.max(stats.timeFirstTokenMs ?? 0, 0), completion)
  const reasoning = Math.min(Math.max(stats.timeThinkingMs ?? 0, 0), completion)
  const waiting = Math.max(0, firstToken - Math.min(reasoning, firstToken))
  const outputTokens = stats.outputTokens
  const generationDuration = completion - firstToken
  const modelTokensPerSecond =
    outputTokens !== undefined && outputTokens > 0 && generationDuration > 0
      ? outputTokens / (generationDuration / 1000)
      : undefined
  const endToEndTokensPerSecond =
    outputTokens !== undefined && outputTokens > 0 ? outputTokens / (completion / 1000) : undefined
  const intervals: MessagePerformanceInterval[] = []
  if (waiting > 0) {
    intervals.push({
      id: 'legacy-waiting-first-token',
      lane: 'other',
      label: 'waiting-first-token',
      startedAt: 0,
      completedAt: waiting
    })
  }
  if (reasoning > 0) {
    intervals.push({
      id: 'legacy-reasoning-time',
      lane: 'model',
      label: 'reasoning-time',
      startedAt: waiting,
      completedAt: Math.min(completion, waiting + reasoning)
    })
  }
  const textStartedAt = Math.min(completion, waiting + reasoning)
  if (completion > textStartedAt) {
    intervals.push({
      id: 'legacy-text-generation',
      lane: 'model',
      label: 'text-generation',
      startedAt: textStartedAt,
      completedAt: completion
    })
  }

  return {
    startedAt: 0,
    completedAt: completion,
    totalDurationMs: completion,
    ...(stats.timeFirstTokenMs !== undefined ? { timeFirstTokenMs: firstToken } : {}),
    modelTokensPerSecond,
    endToEndTokensPerSecond,
    intervals
  }
}

export function buildMessagePerformanceViewModel(
  stats: MessageStats,
  records: readonly AiUsageRecordEntry[] = [],
  now = Date.now()
): MessagePerformanceViewModel {
  return stats.runtimeTiming ? buildRuntimeViewModel(stats, records, now) : buildLegacyViewModel(stats)
}

export function getMessageModelTokensPerSecond(stats: MessageStats): number | undefined {
  if (stats.runtimeTiming) {
    const outputTokens = stats.providerPerformance?.measuredOutputTokens
    const durationMs = stats.providerPerformance?.generationDurationMs
    return outputTokens !== undefined && outputTokens > 0 && durationMs !== undefined && durationMs > 0
      ? outputTokens / (durationMs / 1000)
      : undefined
  }
  return buildLegacyViewModel(stats).modelTokensPerSecond
}
