import type { AgentMessageUsage } from '@cherrystudio/remote-protocol/agent'
import type { MessageStats, MessageRuntimeTiming } from '@shared/data/types/message'

const known = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined

function spanDuration(timing: MessageRuntimeTiming | undefined, kind: 'tool-execution' | 'approval-wait') {
  if (timing?.completedAt === undefined) return undefined
  const end = timing.completedAt
  const intervals = timing.spans
    .filter((span) => span.kind === kind)
    .map((span) => ({ start: Math.max(timing.startedAt, span.startedAt), end: Math.min(end, span.completedAt ?? end) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start)
  if (!intervals.length) return undefined
  let duration = 0
  let previousEnd = timing.startedAt
  for (const interval of intervals) {
    duration += Math.max(0, interval.end - Math.max(previousEnd, interval.start))
    previousEnd = Math.max(previousEnd, interval.end)
  }
  return known(duration)
}

/** The host owns accounting; never reconstruct tokens from generated text. */
export function toMessageUsage(stats: MessageStats | null | undefined): AgentMessageUsage | undefined {
  if (!stats) return undefined
  const timing = stats.runtimeTiming
  const usage: AgentMessageUsage = {
    inputTokens: known(stats.inputTokens),
    outputTokens: known(stats.outputTokens),
    totalTokens: known(stats.totalTokens),
    noCacheTokens: known(stats.inputTokenDetails?.noCacheTokens),
    cacheReadTokens: known(stats.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: known(stats.inputTokenDetails?.cacheWriteTokens),
    reasoningTokens: known(stats.outputTokenDetails?.reasoningTokens),
    requestCount: stats.requestCount,
    hasUnpricedRecords: stats.unpricedRequestCount === undefined ? undefined : stats.unpricedRequestCount > 0,
    costs: stats.costs,
    durationMs: timing
      ? timing.completedAt === undefined
        ? undefined
        : known(timing.completedAt - timing.startedAt)
      : known(stats.timeCompletionMs),
    toolDurationMs: spanDuration(timing, 'tool-execution'),
    approvalDurationMs: spanDuration(timing, 'approval-wait')
  }
  // Canonical event/checkpoint encoding rejects undefined, even on optional keys.
  for (const key of Object.keys(usage)) if (usage[key] === undefined) delete usage[key]
  return Object.keys(usage).length ? usage : undefined
}
