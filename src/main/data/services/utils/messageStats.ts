import type { MessageRuntimeSpan, MessageRuntimeTiming, MessageStats } from '@shared/data/types/message'

import type { MessageUsageProjection } from '../aiUsageRecord'

export type MessageRuntimeStatsInput = Readonly<Pick<MessageStats, 'runtimeTiming'>>

type MessageOwnedStats = Omit<MessageStats, keyof MessageUsageProjection>
type PersistedMessageStats = MessageStats & {
  cost?: unknown
  costCurrency?: unknown
  costSource?: unknown
  costBreakdown?: unknown
  pricingSnapshot?: unknown
}

const MESSAGE_USAGE_PROJECTION_KEY_BY_NAME = {
  inputTokens: 'inputTokens',
  outputTokens: 'outputTokens',
  totalTokens: 'totalTokens',
  inputTokenDetails: 'inputTokenDetails',
  outputTokenDetails: 'outputTokenDetails',
  requestCount: 'requestCount',
  estimatedRequestCount: 'estimatedRequestCount',
  unpricedRequestCount: 'unpricedRequestCount',
  costs: 'costs',
  providerPerformance: 'providerPerformance'
} satisfies { [Key in keyof Required<MessageUsageProjection>]: Key }

const MESSAGE_USAGE_PROJECTION_KEYS = Object.values(MESSAGE_USAGE_PROJECTION_KEY_BY_NAME)
const LEGACY_RECORD_OWNED_KEYS = ['cost', 'costCurrency', 'costSource', 'costBreakdown', 'pricingSnapshot'] as const

function splitMessageStats(stats: MessageStats | null | undefined): {
  messageOwned: MessageOwnedStats
  projection: MessageUsageProjection
} {
  const persisted: PersistedMessageStats = stats ?? {}
  const messageOwned: PersistedMessageStats = { ...persisted }
  const projection: MessageUsageProjection = {}

  for (const key of MESSAGE_USAGE_PROJECTION_KEYS) {
    const value = persisted[key]
    if (value !== undefined) Object.assign(projection, { [key]: value })
    delete messageOwned[key]
  }
  for (const key of LEGACY_RECORD_OWNED_KEYS) delete messageOwned[key]

  return { messageOwned, projection }
}

function normalizeMessageOwnedStats(stats: MessageOwnedStats): MessageOwnedStats {
  // `runtimeTiming` is the sole timing source for new-format messages.
  // Scalar timings remain only when no runtime timeline exists.
  return stats.runtimeTiming ? { runtimeTiming: stats.runtimeTiming } : stats
}

function mergeSpan(existing: MessageRuntimeSpan, incoming: MessageRuntimeSpan): MessageRuntimeSpan {
  if (existing.kind !== incoming.kind) return existing

  const completedAt =
    existing.completedAt !== undefined && incoming.completedAt !== undefined
      ? Math.max(existing.completedAt, incoming.completedAt)
      : (incoming.completedAt ?? existing.completedAt)

  return {
    ...existing,
    ...incoming,
    startedAt: Math.min(existing.startedAt, incoming.startedAt),
    ...(completedAt !== undefined ? { completedAt } : {})
  } as MessageRuntimeSpan
}

function mergeMessageRuntimeTiming(
  existing: MessageRuntimeTiming | undefined,
  incoming: MessageRuntimeTiming | undefined
): MessageRuntimeTiming | undefined {
  if (!existing) return incoming
  if (!incoming) return existing

  const spans = new Map(existing.spans.map((span) => [span.id, span]))
  for (const span of incoming.spans) {
    const previous = spans.get(span.id)
    spans.set(span.id, previous ? mergeSpan(previous, span) : span)
  }

  const completedAt =
    existing.completedAt !== undefined && incoming.completedAt !== undefined
      ? Math.max(existing.completedAt, incoming.completedAt)
      : (incoming.completedAt ?? existing.completedAt)

  return {
    startedAt: Math.min(existing.startedAt, incoming.startedAt),
    ...(completedAt !== undefined ? { completedAt } : {}),
    spans: [...spans.values()].sort(
      (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)
    )
  }
}

export function mergeMessageRuntimeStats(
  existing: MessageStats | null | undefined,
  incoming: MessageRuntimeStatsInput | null | undefined
): MessageStats | undefined {
  const { messageOwned, projection } = splitMessageStats(existing)
  const runtimeTiming = mergeMessageRuntimeTiming(messageOwned.runtimeTiming, incoming?.runtimeTiming)
  const merged: MessageStats = {
    ...projection,
    ...normalizeMessageOwnedStats(runtimeTiming ? { runtimeTiming } : messageOwned)
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function mergeMessageUsageProjection(
  existing: MessageStats | null | undefined,
  projection: MessageUsageProjection
): MessageStats {
  const { messageOwned } = splitMessageStats(existing)
  return { ...normalizeMessageOwnedStats(messageOwned), ...projection }
}
