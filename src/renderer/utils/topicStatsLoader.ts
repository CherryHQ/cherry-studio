import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { db } from '@renderer/databases'
import { getTopicById, getTopicMessages, useAllTopics } from '@renderer/hooks/useTopic'
import { getProviderLabel } from '@renderer/i18n/label'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import type { Topic } from '@shared/data/types/topic'

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
 * another API round-trip).
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
 *
 * Note: blocks are still persisted in Dexie in the current v2
 * transition; only topic metadata has been moved to SQLite.
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
// Topic metadata loading
// ---------------------------------------------------------------------------

/**
 * Fetch every topic's metadata (id, name, createdAt, …) from the
 * DataApi. The endpoint is cursor-paginated, so we walk pages until
 * `nextCursor` is absent. Returns an empty array on error so the
 * dashboard can still render an empty-state rather than crashing.
 */
const fetchAllTopicMetadata = async (): Promise<Topic[]> => {
  try {
    const PAGE_SIZE = 200
    const collected: Topic[] = []
    let cursor: string | undefined

    do {
      const response = (await dataApiService.get('/topics', {
        query: { limit: PAGE_SIZE, cursor }
      })) as { items?: Topic[]; nextCursor?: string }
      const items = Array.isArray(response?.items) ? response.items : []
      collected.push(...items)
      cursor = response?.nextCursor
    } while (cursor)

    return collected
  } catch (error) {
    logger.error('Failed to load topic list for stats', error as Error)
    return []
  }
}

/**
 * Resolve the canonical name for a topic. Falls back to a short id
 * prefix if the stored name is empty (DB DEFAULT '' allows untitled
 * topics).
 *
 * Accepts any object that has an `id` and a `name` — works for both
 * the v2 shared `Topic` (loaded from `/topics`) and the renderer
 * `RendererTopic` (returned by `getTopicById`).
 */
const topicDisplayName = (topic: { id: string; name?: string | null }): string => {
  if (topic.name && topic.name.trim().length > 0) return topic.name
  return `Topic ${topic.id.slice(0, 8)}`
}

// ---------------------------------------------------------------------------
// Global stats loader (cache-aware)
// ---------------------------------------------------------------------------

/**
 * Compute the global, cross-topic usage statistics.
 *
 * Reads topic metadata from the DataApi (`/topics`) and then loads
 * each topic's messages via the paginated `getTopicMessages` helper.
 * The 5-minute in-memory cache prevents re-loading on every tab
 * switch. Call `invalidateGlobalStatsCache()` to force a fresh load.
 *
 * **Why not Redux?** In v2 the topic/message data lives in SQLite
 * (via DataApi) — the Redux store no longer holds the canonical
 * message history. Reading from the DataApi ensures the dashboard
 * is always complete, even for topics the user has not visited this
 * session.
 */
export const loadGlobalStats = async (opts: { force?: boolean } = {}): Promise<AggregatedStats> => {
  const now = Date.now()
  if (!opts.force && globalCache && globalCache.expiresAt > now) {
    return globalCache.data
  }

  const t0 = now
  const topics = await fetchAllTopicMetadata()

  // Load all messages in parallel — `getTopicMessages` handles its own
  // pagination. We map the result back to the topic id so the per-topic
  // snapshot below has its messages available.
  const messageLists = await Promise.all(
    topics.map((t) =>
      getTopicMessages(t.id).catch((e) => {
        logger.warn(`Failed to load messages for topic ${t.id}`, e as Error)
        return [] as Message[]
      })
    )
  )
  const allMessages: Message[] = []
  const messagesByTopic = new Map<string, Message[]>()
  for (let i = 0; i < topics.length; i++) {
    const list = messageLists[i] ?? []
    messagesByTopic.set(topics[i].id, list)
    for (const m of list) allMessages.push(m)
  }

  const blocks = await loadBlocksForMessages(allMessages)
  const lookup = buildBlockLookup(Array.from(blocks.values()))

  const dailyUsage = computeDailyUsage(allMessages)
  const modelUsage = resolveModelUsage(computeModelStats(allMessages))

  // Per-topic snapshot (for the topic list in the settings page)
  const topicStats = topics.map((t) => {
    const messages = messagesByTopic.get(t.id) ?? []
    return {
      topicId: t.id,
      topicName: topicDisplayName(t),
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
 * Compute usage statistics for a single topic. Uses the v2 helpers
 * `getTopicById` (which already loads messages) and Dexie's
 * `message_blocks` table.
 */
export const loadTopicStats = async (topicId: string) => {
  const topic = await getTopicById(topicId)
  if (!topic) return null
  const messages = topic.messages ?? []
  const blocks = await loadBlocksForMessages(messages)
  const lookup = buildBlockLookup(Array.from(blocks.values()))

  const stats = computeTopicStats(messages, lookup)
  const modelUsage = resolveModelUsage(stats.modelUsage)

  return {
    topicId: topic.id,
    topicName: topicDisplayName(topic),
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
 * hit the DataApi on every keystroke.
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

// Re-export `useAllTopics` so the React layer can subscribe to the
// raw topic list alongside the cached aggregate.
export { useAllTopics }
