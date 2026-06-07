import { loggerService } from '@logger'
import { db } from '@renderer/databases'
import { TopicManager } from '@renderer/hooks/useTopic'
import { getProviderLabel } from '@renderer/i18n/label'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

import {
  type BlockLookup,
  computeDailyUsage,
  computeModelStats,
  computeTopicStats,
  countWords,
  type DailyUsage,
  extractMessageText,
  type ModelUsage
} from './topicStats'

const logger = loggerService.withContext('Utils:topicStatsLoader')

/**
 * Aggregation result plus the raw input used to compute it, so the UI
 * layer can re-render efficiently (e.g. when the user toggles a
 * provider filter, we can re-derive from the same snapshot without
 * another DB round-trip).
 */
export interface AggregatedStats {
  /** Number of topics included. */
  topicCount: number
  /** Concatenated message list across all included topics. */
  messages: Message[]
  /** Per-topic snapshot (used by topic list in the settings page). */
  topicStats: Array<{ topicId: string; topicName: string; stats: ReturnType<typeof computeTopicStats> }>
  /** Aggregated daily usage (already sorted by date asc). */
  dailyUsage: DailyUsage[]
  /** Aggregated model usage (sorted by totalTokens desc, with provider label resolved). */
  modelUsage: ResolvedModelUsage[]
  /** Wall-clock duration of the aggregation call (ms). */
  computedInMs: number
}

// ---------------------------------------------------------------------------
// In-memory cache (5 min TTL, per the original design)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  data: AggregatedStats
  expiresAt: number
}

let globalCache: CacheEntry | null = null

export const invalidateGlobalStatsCache = (): void => {
  globalCache = null
}

// ---------------------------------------------------------------------------
// Block resolution helpers
// ---------------------------------------------------------------------------

const buildBlockLookup = (blocks: MessageBlock[]): BlockLookup => {
  const m = new Map<string, MessageBlock>()
  for (const b of blocks) m.set(b.id, b)
  return m
}

const collectMessageIds = (messages: Message[]): Set<string> => {
  const ids = new Set<string>()
  for (const m of messages) {
    for (const id of m.blocks ?? []) ids.add(id)
  }
  return ids
}

/**
 * Load every block referenced by the given message list from
 * `db.message_blocks`. Blocks that no longer exist (e.g. after a
 * migration) are silently skipped.
 */
const loadBlocksForMessages = async (messages: Message[]): Promise<Map<string, MessageBlock>> => {
  const ids = Array.from(collectMessageIds(messages))
  if (ids.length === 0) return new Map()
  const rows = await db.message_blocks.bulkGet(ids)
  const out = new Map<string, MessageBlock>()
  for (const row of rows) {
    if (row) out.set(row.id, row)
  }
  return out
}

// ---------------------------------------------------------------------------
// Resolved model usage (with provider display name)
// ---------------------------------------------------------------------------

export interface ResolvedModelUsage extends ModelUsage {
  providerName: string
}

const resolveModelUsage = (raw: ModelUsage[]): ResolvedModelUsage[] =>
  raw.map((u) => ({ ...u, providerName: getProviderLabel(u.provider) ?? u.provider }))

// ---------------------------------------------------------------------------
// Topic name resolution
// ---------------------------------------------------------------------------

/**
 * Best-effort topic name lookup. The v2 `db.topics` table only
 * persists `{ id, messages }` (no name column), so we fall back to:
 *   1. The first user message in the topic (truncated)
 *   2. The topic id (last resort)
 */
const topicFallbackName = (topicId: string, messages: Message[]): string => {
  const firstUser = messages.find((m) => m.role === 'user')
  if (firstUser) {
    const text = firstUser.blocks?.[0]
    // blocks array stores ids; the actual text is in message_blocks. We
    // can still produce a useful preview from `usage` or any cached
    // field, but in practice the caller may want to override this
    // from the redux cache. Here we return the topic id if no text
    // is available.
    void text
  }
  // The redux assistant store typically has the canonical name; the
  // UI layer is expected to overlay it. As a final fallback, return
  // a shortened id.
  return `Topic ${topicId.slice(0, 8)}`
}

// ---------------------------------------------------------------------------
// Global stats loader (cache-aware)
// ---------------------------------------------------------------------------

/**
 * Compute the global, cross-topic usage statistics.
 *
 * Reads directly from `db.topics` and `db.message_blocks` (NOT from the
 * Redux cache, which only holds messages for topics visited in the
 * current session) so the result is always complete.
 *
 * Result is cached in-memory for 5 minutes to avoid reloading on every
 * settings tab switch. Call `invalidateGlobalStatsCache()` to force
 * a fresh load.
 */
export const loadGlobalStats = async (opts: { force?: boolean } = {}): Promise<AggregatedStats> => {
  const now = Date.now()
  if (!opts.force && globalCache && globalCache.expiresAt > now) {
    return globalCache.data
  }

  const t0 = now
  const topics = await TopicManager.getAllTopics()
  const allMessages: Message[] = []
  for (const t of topics) {
    for (const m of t.messages ?? []) {
      allMessages.push(m)
    }
  }
  const blocks = await loadBlocksForMessages(allMessages)
  const lookup = buildBlockLookup(Array.from(blocks.values()))

  const dailyUsage = computeDailyUsage(allMessages)
  const modelUsage = resolveModelUsage(computeModelStats(allMessages))

  // Per-topic snapshot (for the topic list in the settings page)
  const topicStats = topics.map((t) => {
    const messages = t.messages ?? []
    return {
      topicId: t.id,
      topicName: topicFallbackName(t.id, messages),
      stats: computeTopicStats(messages, lookup)
    }
  })

  const computedInMs = Date.now() - t0

  const data: AggregatedStats = {
    topicCount: topics.length,
    messages: allMessages,
    topicStats,
    dailyUsage,
    modelUsage,
    computedInMs
  }

  globalCache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  logger.silly(`global stats computed in ${computedInMs}ms across ${topics.length} topics`)
  return data
}

// ---------------------------------------------------------------------------
// Per-topic stats loader (no cache - usually shown once)
// ---------------------------------------------------------------------------

/**
 * Compute usage statistics for a single topic. Loads only the blocks
 * referenced by that topic's messages; no cross-topic aggregation.
 */
export const loadTopicStats = async (topicId: string) => {
  const topic = await TopicManager.getTopic(topicId)
  if (!topic) return null
  const messages = topic.messages ?? []
  const blocks = await loadBlocksForMessages(messages)
  const lookup = buildBlockLookup(Array.from(blocks.values()))

  const stats = computeTopicStats(messages, lookup)
  const modelUsage = resolveModelUsage(stats.modelUsage)

  return {
    topicId: topic.id,
    topicName: topicFallbackName(topic.id, messages),
    stats,
    modelUsage,
    dailyUsage: stats.dailyUsage
  }
}

// ---------------------------------------------------------------------------
// Quick re-aggregation helpers (used by UI when filters change)
// ---------------------------------------------------------------------------

/**
 * Re-compute model aggregation from a previously loaded
 * `AggregatedStats`, applying a predicate + sort. This is what the
 * model search / provider / sort / limit dropdowns use so we don't
 * hit the DB on every keystroke.
 */
export const reaggregateModelUsage = (
  data: AggregatedStats,
  predicate?: (u: ResolvedModelUsage) => boolean,
  sortBy: 'tokens' | 'messages' | 'speed' = 'tokens',
  limit?: number
): ResolvedModelUsage[] => {
  const resolved = data.modelUsage
  const filtered = predicate ? resolved.filter(predicate) : resolved
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'messages') return b.messageCount - a.messageCount
    if (sortBy === 'speed') {
      const aSpeed = a.performance.avgTokensPerSecond ?? 0
      const bSpeed = b.performance.avgTokensPerSecond ?? 0
      return bSpeed - aSpeed
    }
    return b.totalTokens - a.totalTokens
  })
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted
}

/**
 * Sum character / word counts across the provided message slice.
 * Used by the settings page "Conversation Info" panel to provide
 * totals even when the global aggregator is skipped.
 */
export const summarizeText = (messages: Message[], blocks: BlockLookup) => {
  let characters = 0
  let words = 0
  for (const m of messages) {
    const text = extractMessageText(m, blocks)
    if (text) {
      characters += text.length
      words += countWords(text)
    }
  }
  return { characters, words }
}
