import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

/**
 * Pure-function aggregation utilities for conversation usage statistics.
 *
 * This module is intentionally free of any side effects, async I/O, or
 * dependencies on the Redux store, IndexedDB, or i18n. It accepts a list of
 * `Message` objects plus a `MessageBlock` lookup map (so the caller can
 * pre-load blocks from wherever they live — Dexie, Redux cache, etc.) and
 * returns plain JS statistics objects.
 *
 * The UI layer (StatsSettings, TopicStatsPopup, etc.) is responsible for
 * loading data from persistent storage, resolving provider names, and
 * rendering. Keeping the aggregation pure makes it trivially unit-testable
 * and reusable from any caller.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PerformanceMetrics {
  /** Average time to first token (ms), or null if no message reported it. */
  avgFirstTokenMs: number | null
  /** Average total completion time (ms), or null if no message reported it. */
  avgCompletionMs: number | null
  /**
   * Average tokens per second across messages that reported both
   * `completion_tokens` and `time_completion_millsec`. Null if no message
   * had enough data to compute it.
   */
  avgTokensPerSecond: number | null
  /** Number of messages that contributed to at least one of the averages. */
  measuredMessages: number
}

export interface ModelUsage {
  modelId: string
  modelName: string
  provider: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  totalTokens: number
  performance: PerformanceMetrics
}

export interface DailyUsage {
  /** YYYY-MM-DD in local time. */
  date: string
  messageCount: number
  totalTokens: number
}

export interface TopicStats {
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  systemMessageCount: number

  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  totalTokens: number

  totalCharacters: number
  totalWords: number

  /** Duration between first and last message, in ms. Zero if <2 messages. */
  durationMs: number

  createdAt: string
  firstMessageAt: string | null
  lastMessageAt: string | null

  performance: PerformanceMetrics
  modelUsage: ModelUsage[]
  dailyUsage: DailyUsage[]
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Count words in a string.
 *
 * - Each CJK character counts as one word (`/[一-鿿぀-ゟ゠-ヿ]/g`)
 * - Latin words are split on whitespace after CJK characters are removed
 * - Empty/whitespace strings return 0
 */
export const countWords = (text: string): number => {
  if (!text) return 0
  // CJK Unified Ideographs + Hiragana + Katakana + halfwidth/fullwidth forms
  const cjkChars = text.match(/[一-鿿぀-ゟ゠-ヿ]/g)
  const cjkCount = cjkChars?.length ?? 0
  const latinText = text.replace(/[一-鿿぀-ゟ゠-ヿ]/g, ' ').trim()
  const latinWords = latinText.length > 0 ? latinText.split(/\s+/).filter(Boolean).length : 0
  return cjkCount + latinWords
}

// ---------------------------------------------------------------------------
// Block resolution
// ---------------------------------------------------------------------------

export type BlockLookup = Map<string, MessageBlock> | { get(id: string): MessageBlock | undefined }

const getBlock = (blocks: BlockLookup, id: string): MessageBlock | undefined => {
  // Both Map and our duck-typed lookup expose `.get()`
  return (blocks as { get(id: string): MessageBlock | undefined }).get(id)
}

/**
 * Resolve the main text content of a message by looking up its MAIN_TEXT
 * blocks in the provided block lookup. Returns the concatenated text, or an
 * empty string if no main text block exists.
 */
export const extractMessageText = (message: Message, blocks: BlockLookup): string => {
  if (!message?.blocks?.length) return ''
  const parts: string[] = []
  for (const blockId of message.blocks) {
    const block = getBlock(blocks, blockId)
    if (block?.type === MessageBlockType.MAIN_TEXT) {
      parts.push((block as { content: string }).content)
    }
  }
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Performance metrics
// ---------------------------------------------------------------------------

/**
 * Compute average performance metrics across a list of messages.
 *
 * Only messages that actually reported each metric contribute to the
 * corresponding average (independent counters, not a single
 * `messageCount` denominator). This avoids skewing the averages when
 * older messages predate the metrics instrumentation.
 */
export const computePerformanceMetrics = (messages: Message[]): PerformanceMetrics => {
  let firstTokenSum = 0
  let firstTokenCount = 0
  let completionSum = 0
  let completionCount = 0
  let speedSum = 0
  let speedCount = 0
  let measured = 0

  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const metrics = m.metrics
    const usage = m.usage
    if (!metrics && !usage) continue

    let contributed = false

    if (typeof metrics?.time_first_token_millsec === 'number' && metrics.time_first_token_millsec > 0) {
      firstTokenSum += metrics.time_first_token_millsec
      firstTokenCount += 1
      contributed = true
    }
    if (typeof metrics?.time_completion_millsec === 'number' && metrics.time_completion_millsec > 0) {
      completionSum += metrics.time_completion_millsec
      completionCount += 1
      contributed = true
    }
    if (
      metrics &&
      typeof metrics.completion_tokens === 'number' &&
      typeof metrics.time_completion_millsec === 'number' &&
      metrics.time_completion_millsec > 0
    ) {
      const tps = (metrics.completion_tokens / metrics.time_completion_millsec) * 1000
      if (Number.isFinite(tps) && tps > 0) {
        speedSum += tps
        speedCount += 1
      }
    }
    if (contributed) measured += 1
  }

  return {
    avgFirstTokenMs: firstTokenCount > 0 ? firstTokenSum / firstTokenCount : null,
    avgCompletionMs: completionCount > 0 ? completionSum / completionCount : null,
    avgTokensPerSecond: speedCount > 0 ? speedSum / speedCount : null,
    measuredMessages: measured
  }
}

// ---------------------------------------------------------------------------
// Model usage
// ---------------------------------------------------------------------------

const emptyModelPerf = (): PerformanceMetrics => ({
  avgFirstTokenMs: null,
  avgCompletionMs: null,
  avgTokensPerSecond: null,
  measuredMessages: 0
})

interface ModelAggregate {
  modelId: string
  modelName: string
  provider: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  totalTokens: number
  perf: PerformanceMetrics & { _measured: number }
}

const blankAggregate = (modelId: string, modelName: string, provider: string): ModelAggregate => ({
  modelId,
  modelName,
  provider,
  messageCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  totalTokens: 0,
  perf: { ...emptyModelPerf(), _measured: 0 }
})

/**
 * Aggregate token usage and performance metrics per model.
 *
 * Messages are grouped by their `model.id`; messages without a model
 * (typically user messages or legacy messages) are skipped. Tokens are
 * sourced from `Message.usage` (OpenAI-shaped Usage type, with the
 * Cherry Studio extension `thoughts_tokens`).
 */
export const computeModelStats = (messages: Message[]): ModelUsage[] => {
  const byId = new Map<string, ModelAggregate>()

  for (const m of messages) {
    if (m.role !== 'assistant' || !m.model) continue

    const id = m.model.id
    let agg = byId.get(id)
    if (!agg) {
      agg = blankAggregate(id, m.model.name, m.model.provider)
      byId.set(id, agg)
    }
    agg.messageCount += 1

    const usage = m.usage
    if (usage) {
      agg.inputTokens += usage.prompt_tokens ?? 0
      agg.outputTokens += usage.completion_tokens ?? 0
      const thinking = usage.thoughts_tokens ?? 0
      agg.thinkingTokens += thinking
      agg.totalTokens += (usage.total_tokens ?? 0) || usage.prompt_tokens + usage.completion_tokens + thinking
    }

    const metrics = m.metrics
    if (metrics) {
      if (typeof metrics.time_first_token_millsec === 'number' && metrics.time_first_token_millsec > 0) {
        agg.perf.avgFirstTokenMs =
          (agg.perf.avgFirstTokenMs ?? 0) * agg.perf.measuredMessages + metrics.time_first_token_millsec
        agg.perf.measuredMessages += 1
        agg.perf.avgFirstTokenMs = agg.perf.avgFirstTokenMs / agg.perf.measuredMessages
      }
      if (typeof metrics.time_completion_millsec === 'number' && metrics.time_completion_millsec > 0) {
        agg.perf.avgCompletionMs =
          (agg.perf.avgCompletionMs ?? 0) * agg.perf._measured + metrics.time_completion_millsec
        agg.perf._measured += 1
        agg.perf.avgCompletionMs = agg.perf.avgCompletionMs / agg.perf._measured
      }
    }
  }

  return Array.from(byId.values())
    .map(({ perf, ...rest }) => {
      const { _measured, ...cleanPerf } = perf
      void _measured
      return { ...rest, performance: cleanPerf }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

// ---------------------------------------------------------------------------
// Daily usage
// ---------------------------------------------------------------------------

/**
 * Aggregate message/token counts per local-time day (YYYY-MM-DD).
 *
 * Output is sorted by date ascending. Days with zero messages are NOT
 * emitted — the consumer can fill gaps for visualisation.
 */
export const computeDailyUsage = (messages: Message[]): DailyUsage[] => {
  const byDate = new Map<string, { messageCount: number; totalTokens: number }>()

  for (const m of messages) {
    const day = formatLocalDate(m.createdAt)
    if (!day) continue
    let bucket = byDate.get(day)
    if (!bucket) {
      bucket = { messageCount: 0, totalTokens: 0 }
      byDate.set(day, bucket)
    }
    bucket.messageCount += 1
    const usage = m.usage
    if (usage) {
      bucket.totalTokens += usage.total_tokens ?? 0
    }
  }

  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, messageCount: v.messageCount, totalTokens: v.totalTokens }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Top-level aggregation
// ---------------------------------------------------------------------------

/**
 * Compute the full per-topic statistics object.
 *
 * The caller is responsible for:
 *  - loading the message list (and resolving any not-yet-loaded topic)
 *  - providing a `blocks` lookup containing every block referenced by
 *    `message.blocks` (so we can extract main text and count characters)
 *  - resolving provider display names (e.g. via `getProviderLabel`) —
 *    this module does not depend on i18n, so provider names are not
 *    included in the output; callers can add them when rendering.
 */
export const computeTopicStats = (messages: Message[], blocks: BlockLookup): TopicStats => {
  let userCount = 0
  let assistantCount = 0
  let systemCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let thinkingTokens = 0
  let totalTokens = 0
  let totalCharacters = 0
  let totalWords = 0
  let firstAt: number | null = null
  let lastAt: number | null = null
  let earliest = ''
  let latest = ''

  for (const m of messages) {
    if (m.role === 'user') userCount += 1
    else if (m.role === 'assistant') assistantCount += 1
    else if (m.role === 'system') systemCount += 1

    const usage = m.usage
    if (usage) {
      inputTokens += usage.prompt_tokens ?? 0
      outputTokens += usage.completion_tokens ?? 0
      const think = usage.thoughts_tokens ?? 0
      thinkingTokens += think
      totalTokens += (usage.total_tokens ?? 0) || (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) + think
    }

    const text = extractMessageText(m, blocks)
    if (text) {
      totalCharacters += text.length
      totalWords += countWords(text)
    }

    const ts = Date.parse(m.createdAt)
    if (!Number.isNaN(ts)) {
      if (firstAt === null || ts < firstAt) {
        firstAt = ts
        earliest = m.createdAt
      }
      if (lastAt === null || ts > lastAt) {
        lastAt = ts
        latest = m.createdAt
      }
    }
  }

  const durationMs = firstAt !== null && lastAt !== null ? Math.max(0, lastAt - firstAt) : 0

  return {
    messageCount: messages.length,
    userMessageCount: userCount,
    assistantMessageCount: assistantCount,
    systemMessageCount: systemCount,

    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,

    totalCharacters,
    totalWords,

    durationMs,

    createdAt: earliest,
    firstMessageAt: earliest || null,
    lastMessageAt: latest || null,

    performance: computePerformanceMetrics(messages),
    modelUsage: computeModelStats(messages),
    dailyUsage: computeDailyUsage(messages)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO timestamp as YYYY-MM-DD in the local timezone.
 * Returns null if the timestamp is not a valid date.
 */
export const formatLocalDate = (iso: string): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/**
 * Format a duration in milliseconds as a coarse, human-readable string.
 *
 * Granularity: days > hours > minutes (no seconds to avoid flicker on
 * live-updating displays). Localised unit suffixes are the caller's
 * responsibility — the function returns the numeric components.
 */
export const formatDurationParts = (ms: number): { days: number; hours: number; minutes: number } => {
  if (!Number.isFinite(ms) || ms < 0) return { days: 0, hours: 0, minutes: 0 }
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60)
  const minutes = totalMinutes - days * 60 * 24 - hours * 60
  return { days, hours, minutes }
}
