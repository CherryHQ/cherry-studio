import type { Message } from '@renderer/types/newMessage'

import { getMainTextContent } from './messageUtils/find'

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
}

function getMessageCost(message: Message): { inputCost: number; outputCost: number; totalCost: number } {
  const inputTokens = message.usage?.prompt_tokens ?? 0
  const outputTokens = message.usage?.completion_tokens ?? 0
  const model = message.model

  // OpenRouter uses cost directly from usage
  if (model?.provider === 'openrouter' && message.usage?.cost !== undefined) {
    const total = message.usage.cost
    // Estimate split: proportional to token counts
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
  // For CJK: count each CJK character as a word
  // For Latin: split by whitespace
  const cjkChars = (text.match(/[一-鿿぀-ゟ゠-ヿ]/g) || []).length
  const latinWords = text
    .replace(/[一-鿿぀-ゟ゠-ヿ]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0).length
  return cjkChars + latinWords
}

function computeModelStats(messages: Message[]): ModelStats[] {
  const modelMap = new Map<string, ModelStats>()

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.usage) continue

    const modelId = msg.modelId || msg.model?.id || 'unknown'
    const modelName = msg.model?.name || msg.modelId || 'Unknown Model'
    const provider = msg.model?.provider || 'unknown'

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

    if (msg.metrics) {
      stats.avgFirstTokenLatency += msg.metrics.time_first_token_millsec ?? 0
      stats.avgCompletionTime += msg.metrics.time_completion_millsec ?? 0
      const speed =
        msg.metrics.time_completion_millsec > 0
          ? (msg.metrics.completion_tokens / msg.metrics.time_completion_millsec) * 1000
          : 0
      stats.avgTokensPerSecond += speed
    }
  }

  // Compute averages
  for (const stats of modelMap.values()) {
    if (stats.messageCount > 0) {
      stats.avgFirstTokenLatency /= stats.messageCount
      stats.avgCompletionTime /= stats.messageCount
      stats.avgTokensPerSecond /= stats.messageCount
    }
  }

  return Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens)
}

export function computeTopicStats(messages: Message[]): TopicStats {
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
    modelStats: []
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
  let totalCompletionTime = 0
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

    // Content stats (for all message types)
    const textContent = getMainTextContent(msg)
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

      // Performance metrics
      if (msg.metrics) {
        const ftLatency = msg.metrics.time_first_token_millsec ?? 0
        const compTime = msg.metrics.time_completion_millsec ?? 0
        if (ftLatency > 0) totalFtLatency += ftLatency
        if (compTime > 0) totalCompletionTime += compTime

        if (compTime > 0 && msg.metrics.completion_tokens > 0) {
          totalSpeed += (msg.metrics.completion_tokens / compTime) * 1000
          speedCount++
        }
      }
    }
  }

  const durationMs =
    firstMessageAt && lastMessageAt ? new Date(lastMessageAt).getTime() - new Date(firstMessageAt).getTime() : 0

  // Compute averages
  const avgFtLatency = assistantMessages > 0 ? totalFtLatency / assistantMessages : 0
  const avgCompTime = assistantMessages > 0 ? totalCompletionTime / assistantMessages : 0
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
    modelStats: computeModelStats(messages)
  }
}
