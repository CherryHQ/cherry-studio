import db from '@renderer/databases'
import store from '@renderer/store'
import type { Message, MessageBlock } from '@renderer/types/newMessage'

export interface ModelStats {
  modelId: string
  modelName: string
  provider: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  totalTokens: number
  cost: number
  avgFirstTokenLatency: number
  avgCompletionTime: number
  avgTokensPerSecond: number
}

export interface DailyUsage {
  date: string // YYYY-MM-DD
  messages: number
  tokens: number
  cost: number
}

export interface TopicStats {
  // Overview
  totalMessages: number
  userMessages: number
  assistantMessages: number

  // Tokens
  totalInputTokens: number
  totalOutputTokens: number
  totalThinkingTokens: number
  totalTokens: number

  // Cost
  totalCost: number
  inputCost: number
  outputCost: number

  // Performance (weighted averages across all assistant messages)
  avgFirstTokenLatency: number
  avgCompletionTime: number
  avgTokensPerSecond: number

  // Content
  totalCharacters: number
  totalWords: number

  // Timeline
  firstMessageAt: string | null
  lastMessageAt: string | null
  durationMs: number

  // Per-model breakdown
  modelStats: ModelStats[]

  // Daily usage for heatmap
  dailyUsage: DailyUsage[]
}

function getMessageCost(message: Message): { inputCost: number; outputCost: number; totalCost: number } {
  const inputTokens = message.usage?.prompt_tokens ?? 0
  const outputTokens = message.usage?.completion_tokens ?? 0
  const model = message.model

  // OpenRouter uses cost directly from usage
  if (model?.provider === 'openrouter' && message.usage?.cost !== undefined) {
    const total = message.usage.cost
    const totalTokens = inputTokens + outputTokens || 1
    const inputRatio = inputTokens / totalTokens
    return {
      inputCost: total * inputRatio,
      outputCost: total * (1 - inputRatio),
      totalCost: total
    }
  }

  if (
    !model?.pricing ||
    (model.pricing.input_per_million_tokens === 0 && model.pricing.output_per_million_tokens === 0)
  ) {
    return { inputCost: 0, outputCost: 0, totalCost: 0 }
  }

  const inputCost = (inputTokens * (model.pricing.input_per_million_tokens ?? 0)) / 1_000_000
  const outputCost = (outputTokens * (model.pricing.output_per_million_tokens ?? 0)) / 1_000_000
  return { inputCost, outputCost, totalCost: inputCost + outputCost }
}

function getWordCount(text: string): number {
  if (!text) return 0
  const cjkChars = (text.match(/[一-鿿぀-ゟ゠-ヿ]/g) || []).length
  const latinWords = text
    .replace(/[一-鿿぀-ゟ゠-ヿ]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0).length
  return cjkChars + latinWords
}

/**
 * Extract text content directly from message + its blocks (loaded from DB).
 * Does NOT depend on Redux store.
 */
function extractTextContent(message: Message, blocksMap: Map<string, MessageBlock>): string {
  if (!message.blocks || message.blocks.length === 0) return ''
  const parts: string[] = []
  for (const blockId of message.blocks) {
    const block = blocksMap.get(blockId)
    if (!block) continue
    // Count MAIN_TEXT, THINKING, CODE, and any block type with content
    const content = (block as any).content
    if (content && typeof content === 'string') {
      parts.push(content)
    }
  }
  return parts.join('\n\n')
}

function resolveProvider(msg: Message): string {
  // Try model.provider first
  const providerId = msg.model?.provider
  if (providerId) {
    // UUID pattern — look up from Redux store to get the actual provider name
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId)) {
      try {
        const state = store.getState()
        const providers = (state as any).llm?.providers as { id: string; name: string }[] | undefined
        const found = providers?.find((p) => p.id === providerId)
        if (found?.name) return found.name
      } catch {
        // Fall through
      }
    }
    // Known provider type names
    return providerId
  }
  // Try to infer from model id (e.g. "openai/gpt-4o" → "openai")
  const mid = msg.modelId || msg.model?.id
  if (mid) {
    const slashIdx = mid.indexOf('/')
    if (slashIdx > 0) return mid.slice(0, slashIdx)
    // Common prefixes
    if (mid.startsWith('claude-')) return 'anthropic'
    if (mid.startsWith('gemini-')) return 'google'
  }
  return 'unknown'
}

function resolveModelName(msg: Message): string {
  if (msg.model?.name) return msg.model.name
  if (msg.modelId) return msg.modelId
  if (msg.model?.id) return msg.model.id
  return 'Unknown Model'
}

function computeModelStats(messages: Message[]): ModelStats[] {
  const modelMap = new Map<string, ModelStats>()

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.usage) continue

    const modelId = msg.modelId || msg.model?.id || 'unknown'
    const modelName = resolveModelName(msg)
    const provider = resolveProvider(msg)

    let stats = modelMap.get(modelId)
    if (!stats) {
      stats = {
        modelId,
        modelName,
        provider,
        messageCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        cost: 0,
        avgFirstTokenLatency: 0,
        avgCompletionTime: 0,
        avgTokensPerSecond: 0
      }
      modelMap.set(modelId, stats)
    }

    stats.messageCount++
    stats.inputTokens += msg.usage.prompt_tokens ?? 0
    stats.outputTokens += msg.usage.completion_tokens ?? 0
    stats.thinkingTokens += msg.usage.thoughts_tokens ?? 0
    stats.totalTokens += msg.usage.total_tokens ?? 0

    const cost = getMessageCost(msg)
    stats.cost += cost.totalCost

    // Accumulate raw values; use separate counters for proper averaging
    ;(stats as any)._ftCount = (stats as any)._ftCount || 0
    ;(stats as any)._compCount = (stats as any)._compCount || 0
    ;(stats as any)._speedCount = (stats as any)._speedCount || 0
    if (msg.metrics) {
      const ft = msg.metrics.time_first_token_millsec ?? 0
      if (ft > 0) {
        stats.avgFirstTokenLatency += ft
        ;(stats as any)._ftCount++
      }
      const ct = msg.metrics.time_completion_millsec ?? 0
      if (ct > 0) {
        stats.avgCompletionTime += ct
        ;(stats as any)._compCount++
        if (msg.metrics.completion_tokens > 0) {
          stats.avgTokensPerSecond += (msg.metrics.completion_tokens / ct) * 1000
          ;(stats as any)._speedCount++
        }
      }
    }
  }

  // Compute averages per model using actual counts
  for (const stats of modelMap.values()) {
    const fc = (stats as any)._ftCount || 0
    const cc = (stats as any)._compCount || 0
    const sc = (stats as any)._speedCount || 0
    stats.avgFirstTokenLatency = fc > 0 ? stats.avgFirstTokenLatency / fc : 0
    stats.avgCompletionTime = cc > 0 ? stats.avgCompletionTime / cc : 0
    stats.avgTokensPerSecond = sc > 0 ? stats.avgTokensPerSecond / sc : 0
    delete (stats as any)._ftCount
    delete (stats as any)._compCount
    delete (stats as any)._speedCount
  }

  return Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

function computeDailyUsage(messages: Message[]): DailyUsage[] {
  const dailyMap = new Map<string, DailyUsage>()

  for (const msg of messages) {
    if (!msg.createdAt) continue
    const date = msg.createdAt.slice(0, 10) // YYYY-MM-DD
    let entry = dailyMap.get(date)
    if (!entry) {
      entry = { date, messages: 0, tokens: 0, cost: 0 }
      dailyMap.set(date, entry)
    }
    entry.messages++
    if (msg.role === 'assistant' && msg.usage) {
      entry.tokens += msg.usage.total_tokens ?? 0
      const cost = getMessageCost(msg)
      entry.cost += cost.totalCost
    }
  }

  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function computeTopicStats(messages: Message[], blocksMap?: Map<string, MessageBlock>): TopicStats {
  const emptyStats: TopicStats = {
    totalMessages: 0,
    userMessages: 0,
    assistantMessages: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalThinkingTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    avgFirstTokenLatency: 0,
    avgCompletionTime: 0,
    avgTokensPerSecond: 0,
    totalCharacters: 0,
    totalWords: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    durationMs: 0,
    modelStats: [],
    dailyUsage: []
  }

  if (!messages || messages.length === 0) {
    return emptyStats
  }

  let userMessages = 0
  let assistantMessages = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalThinkingTokens = 0
  let totalCost = 0
  let inputCostSum = 0
  let outputCostSum = 0
  let totalFtLatency = 0
  let ftCount = 0
  let totalCompletionTime = 0
  let compCount = 0
  let totalSpeed = 0
  let speedCount = 0
  let totalChars = 0
  let totalWords = 0
  let firstMessageAt: string | null = null
  let lastMessageAt: string | null = null

  for (const msg of messages) {
    // Count by role
    if (msg.role === 'user') {
      userMessages++
    } else if (msg.role === 'assistant') {
      assistantMessages++
    }

    // Timeline
    if (msg.createdAt) {
      if (!firstMessageAt || msg.createdAt < firstMessageAt) firstMessageAt = msg.createdAt
      if (!lastMessageAt || msg.createdAt > lastMessageAt) lastMessageAt = msg.createdAt
    }

    // Content stats — use blocksMap if available, otherwise try getMainTextContent
    let textContent = ''
    if (blocksMap) {
      textContent = extractTextContent(msg, blocksMap)
    }
    if (textContent) {
      totalChars += textContent.length
      totalWords += getWordCount(textContent)
    }

    // Token and cost stats (assistant messages with usage data)
    if (msg.role === 'assistant' && msg.usage) {
      totalInputTokens += msg.usage.prompt_tokens ?? 0
      totalOutputTokens += msg.usage.completion_tokens ?? 0
      totalThinkingTokens += msg.usage.thoughts_tokens ?? 0

      const cost = getMessageCost(msg)
      totalCost += cost.totalCost
      inputCostSum += cost.inputCost
      outputCostSum += cost.outputCost

      // Performance metrics — only count messages that actually have metrics data
      if (msg.metrics) {
        const ftLatency = msg.metrics.time_first_token_millsec ?? 0
        const compTime = msg.metrics.time_completion_millsec ?? 0
        if (ftLatency > 0) {
          totalFtLatency += ftLatency
          ftCount++
        }
        if (compTime > 0) {
          totalCompletionTime += compTime
          compCount++
        }

        if (compTime > 0 && msg.metrics.completion_tokens > 0) {
          totalSpeed += (msg.metrics.completion_tokens / compTime) * 1000
          speedCount++
        }
      }
    }
  }

  // Use live time for duration if there are messages (so it updates in real-time)
  const durationMs = firstMessageAt ? Date.now() - new Date(firstMessageAt).getTime() : 0

  // Compute averages — only over messages that actually reported each metric
  const avgFtLatency = ftCount > 0 ? totalFtLatency / ftCount : 0
  const avgCompTime = compCount > 0 ? totalCompletionTime / compCount : 0
  const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 0

  return {
    totalMessages: messages.length,
    userMessages,
    assistantMessages,
    totalInputTokens,
    totalOutputTokens,
    totalThinkingTokens,
    totalTokens: totalInputTokens + totalOutputTokens + totalThinkingTokens,
    totalCost,
    inputCost: inputCostSum,
    outputCost: outputCostSum,
    avgFirstTokenLatency: avgFtLatency,
    avgCompletionTime: avgCompTime,
    avgTokensPerSecond: avgSpeed,
    totalCharacters: totalChars,
    totalWords,
    firstMessageAt,
    lastMessageAt,
    durationMs,
    modelStats: computeModelStats(messages),
    dailyUsage: computeDailyUsage(messages)
  }
}

// ─── Cache ──────────────────────────────────────────────────────────────────

let _globalCache: { stats: TopicStats; ts: number } | null = null
const CACHE_TTL = 300_000 // 5min — avoids reload on tab switch, still fresh enough

/**
 * Load messages + blocks for a specific topic from the database and compute stats.
 */
export async function computeTopicStatsFromDB(topicId: string): Promise<TopicStats> {
  try {
    const topic = await db.topics.get(topicId)
    const messages = topic?.messages || []

    // Load all blocks for these messages from the message_blocks table
    const messageIds = messages.map((m) => m.id)
    const blocks = await db.message_blocks.where('messageId').anyOf(messageIds).toArray()
    const blocksMap = new Map<string, MessageBlock>()
    for (const block of blocks) {
      blocksMap.set(block.id, block)
    }

    return computeTopicStats(messages, blocksMap)
  } catch {
    return computeTopicStats([])
  }
}

/**
 * Load ALL messages + blocks from all topics in the database and compute global stats.
 * Results are cached for 30s to avoid loading spinner on every tab switch.
 */
export async function computeGlobalStatsFromDB(): Promise<TopicStats> {
  if (_globalCache && Date.now() - _globalCache.ts < CACHE_TTL) {
    return _globalCache.stats
  }
  try {
    const allTopics = await db.topics.toArray()
    const allMessages = allTopics.flatMap((t) => t.messages || [])

    // Load ALL blocks from the message_blocks table
    const allBlocks = await db.message_blocks.toArray()
    const blocksMap = new Map<string, MessageBlock>()
    for (const block of allBlocks) {
      blocksMap.set(block.id, block)
    }

    const stats = computeTopicStats(allMessages, blocksMap)
    _globalCache = { stats, ts: Date.now() }
    return stats
  } catch {
    return computeTopicStats([])
  }
}

/** Invalidate the global stats cache so the next call re-loads from DB */
export function invalidateGlobalStatsCache(): void {
  _globalCache = null
}
