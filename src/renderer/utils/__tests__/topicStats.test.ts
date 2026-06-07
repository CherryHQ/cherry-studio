import type { Model } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import {
  computeDailyUsage,
  computeModelStats,
  computePerformanceMetrics,
  computeTopicStats,
  countWords,
  extractMessageText,
  formatDurationParts,
  formatLocalDate
} from '../topicStats'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let blockCounter = 0
const nextId = (prefix: string) => `${prefix}-${++blockCounter}`

interface BlockSpec {
  id?: string
  type: MessageBlockType
  content?: string
}

const makeBlock = (spec: BlockSpec): MessageBlock => {
  const id = spec.id ?? nextId('block')
  const base = {
    id,
    messageId: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    status: MessageBlockStatus.SUCCESS
  }
  switch (spec.type) {
    case MessageBlockType.MAIN_TEXT:
      return { ...base, type: MessageBlockType.MAIN_TEXT, content: spec.content ?? '' }
    case MessageBlockType.THINKING:
      return { ...base, type: MessageBlockType.THINKING, content: spec.content ?? '', thinking_millsec: 0 }
    case MessageBlockType.TOOL:
      return { ...base, type: MessageBlockType.TOOL } as MessageBlock
    default:
      return { ...base, type: spec.type } as MessageBlock
  }
}

interface MessageSpec {
  id: string
  role: 'user' | 'assistant' | 'system'
  createdAt: string
  blocks?: BlockSpec[]
  model?: Pick<Model, 'id' | 'name' | 'provider'>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    thoughts_tokens?: number
  }
  metrics?: {
    completion_tokens?: number
    time_completion_millsec?: number
    time_first_token_millsec?: number
    time_thinking_millsec?: number
  }
}

const makeMessages = (specs: MessageSpec[]): { messages: Message[]; blocks: Map<string, MessageBlock> } => {
  const messages: Message[] = []
  const blocks = new Map<string, MessageBlock>()
  for (const spec of specs) {
    const messageBlocks: MessageBlock[] = []
    for (const bs of spec.blocks ?? []) {
      const block = makeBlock({ ...bs, id: bs.id ?? nextId('block') })
      block.messageId = spec.id
      blocks.set(block.id, block)
      messageBlocks.push(block)
    }
    const msg: Message = {
      id: spec.id,
      role: spec.role,
      assistantId: 'a-1',
      topicId: 't-1',
      createdAt: spec.createdAt,
      status: spec.role === 'assistant' ? AssistantMessageStatus.SUCCESS : ('success' as never),
      blocks: messageBlocks.map((b) => b.id)
    }
    if (spec.model) {
      msg.model = {
        id: spec.model.id,
        name: spec.model.name,
        provider: spec.model.provider,
        group: 'gpt-4o'
      }
    }
    if (spec.usage) msg.usage = spec.usage as Message['usage']
    if (spec.metrics) msg.metrics = spec.metrics as Message['metrics']
    messages.push(msg)
  }
  return { messages, blocks }
}

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('returns 0 for empty input', () => {
    expect(countWords('')).toBe(0)
  })

  it('counts each CJK character as one word', () => {
    expect(countWords('你好世界')).toBe(4)
    expect(countWords('こんにちは')).toBe(5)
  })

  it('counts Latin words split on whitespace', () => {
    expect(countWords('hello world')).toBe(2)
    expect(countWords('  multiple   spaces  ')).toBe(2)
  })

  it('mixes CJK and Latin counts', () => {
    // "你好 world" -> 2 CJK chars + 1 Latin word = 3
    expect(countWords('你好 world')).toBe(3)
    // "Hello 你好 World" -> 2 Latin words + 2 CJK = 4
    expect(countWords('Hello 你好 World')).toBe(4)
  })

  it('handles punctuation without inflating counts', () => {
    expect(countWords('hello, world!')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// extractMessageText
// ---------------------------------------------------------------------------

describe('extractMessageText', () => {
  it('returns empty string for messages with no blocks', () => {
    const m: Message = {
      id: 'm',
      role: 'user',
      assistantId: 'a',
      topicId: 't',
      createdAt: '2026-06-01T00:00:00.000Z',
      status: 'success' as never,
      blocks: []
    }
    expect(extractMessageText(m, new Map())).toBe('')
  })

  it('concatenates main-text blocks only, in order', () => {
    const { messages, blocks } = makeMessages([
      {
        id: 'm',
        role: 'assistant',
        createdAt: '2026-06-01T00:00:00.000Z',
        blocks: [
          { type: MessageBlockType.MAIN_TEXT, content: 'first part' },
          { type: MessageBlockType.THINKING, content: 'should be ignored' },
          { type: MessageBlockType.MAIN_TEXT, content: 'second part' }
        ]
      }
    ])
    const result = extractMessageText(messages[0], blocks)
    expect(result).toBe('first part\n\nsecond part')
  })

  it('accepts a duck-typed lookup with .get()', () => {
    const { messages, blocks } = makeMessages([
      {
        id: 'm',
        role: 'assistant',
        createdAt: '2026-06-01T00:00:00.000Z',
        blocks: [{ type: MessageBlockType.MAIN_TEXT, content: 'hello' }]
      }
    ])
    const duck = { get: (id: string) => blocks.get(id) }
    expect(extractMessageText(messages[0], duck)).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// computePerformanceMetrics
// ---------------------------------------------------------------------------

describe('computePerformanceMetrics', () => {
  it('returns nulls and zero measured when given only user messages', () => {
    const { messages } = makeMessages([{ id: 'u1', role: 'user', createdAt: '2026-06-01T00:00:00.000Z' }])
    const m = computePerformanceMetrics(messages)
    expect(m.avgFirstTokenMs).toBeNull()
    expect(m.avgCompletionMs).toBeNull()
    expect(m.avgTokensPerSecond).toBeNull()
    expect(m.measuredMessages).toBe(0)
  })

  it('averages time_first_token_millsec across messages that have it', () => {
    const { messages } = makeMessages([
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-06-01T00:00:00.000Z',
        metrics: { time_first_token_millsec: 100, time_completion_millsec: 1000, completion_tokens: 50 }
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: '2026-06-01T00:01:00.000Z',
        metrics: { time_first_token_millsec: 300, time_completion_millsec: 1000, completion_tokens: 50 }
      },
      {
        id: 'a3',
        role: 'assistant',
        createdAt: '2026-06-01T00:02:00.000Z'
        // no metrics
      }
    ])
    const m = computePerformanceMetrics(messages)
    expect(m.avgFirstTokenMs).toBe(200) // (100 + 300) / 2
    expect(m.avgCompletionMs).toBe(1000)
    // speed = (50/1000 + 50/1000) * 1000 = 100 tps
    expect(m.avgTokensPerSecond).toBeCloseTo(100, 5)
    expect(m.measuredMessages).toBe(2)
  })

  it('ignores zero/negative timing values (treats as missing)', () => {
    const { messages } = makeMessages([
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-06-01T00:00:00.000Z',
        metrics: { time_first_token_millsec: 0, time_completion_millsec: 0, completion_tokens: 50 }
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: '2026-06-01T00:01:00.000Z',
        metrics: { time_first_token_millsec: 200, time_completion_millsec: 1000, completion_tokens: 50 }
      }
    ])
    const m = computePerformanceMetrics(messages)
    // Only a2 contributes to first-token average
    expect(m.avgFirstTokenMs).toBe(200)
    expect(m.measuredMessages).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeModelStats
// ---------------------------------------------------------------------------

describe('computeModelStats', () => {
  it('groups by model.id and sums tokens', () => {
    const { messages } = makeMessages([
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-06-01T00:00:00.000Z',
        model: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, thoughts_tokens: 10 }
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: '2026-06-01T00:01:00.000Z',
        model: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, thoughts_tokens: 5 }
      },
      {
        id: 'a3',
        role: 'assistant',
        createdAt: '2026-06-01T00:02:00.000Z',
        model: { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
        usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
      }
    ])

    const result = computeModelStats(messages)
    expect(result).toHaveLength(2)

    // Sorted by totalTokens desc, so gpt-4o (430) comes first
    const gpt = result.find((r) => r.modelId === 'gpt-4o')!
    const claude = result.find((r) => r.modelId === 'claude-opus-4-6')!

    expect(gpt.messageCount).toBe(2)
    expect(gpt.inputTokens).toBe(300)
    expect(gpt.outputTokens).toBe(130)
    expect(gpt.thinkingTokens).toBe(15)
    expect(gpt.totalTokens).toBe(430)

    expect(claude.messageCount).toBe(1)
    expect(claude.inputTokens).toBe(50)
    expect(claude.outputTokens).toBe(25)
    expect(claude.thinkingTokens).toBe(0)
    expect(claude.totalTokens).toBe(75)
  })

  it('skips user/system messages and assistant messages without a model', () => {
    const { messages } = makeMessages([
      { id: 'u1', role: 'user', createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 's1', role: 'system', createdAt: '2026-06-01T00:00:01.000Z' },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-06-01T00:01:00.000Z'
        // no model
      }
    ])
    expect(computeModelStats(messages)).toEqual([])
  })

  it('falls back to prompt+completion+thinking when total_tokens is missing', () => {
    const { messages } = makeMessages([
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-06-01T00:00:00.000Z',
        model: { id: 'm', name: 'M', provider: 'p' },
        usage: { prompt_tokens: 10, completion_tokens: 20, thoughts_tokens: 5 }
        // total_tokens intentionally omitted
      }
    ])
    const [r] = computeModelStats(messages)
    expect(r.totalTokens).toBe(35)
  })
})

// ---------------------------------------------------------------------------
// computeDailyUsage
// ---------------------------------------------------------------------------

describe('computeDailyUsage', () => {
  it('aggregates per local day and sorts ascending', () => {
    const { messages } = makeMessages([
      { id: 'a', role: 'user', createdAt: '2026-06-01T10:00:00.000Z' },
      { id: 'b', role: 'assistant', createdAt: '2026-06-01T11:00:00.000Z', usage: { total_tokens: 100 } },
      { id: 'c', role: 'user', createdAt: '2026-06-02T09:00:00.000Z' },
      { id: 'd', role: 'assistant', createdAt: '2026-06-03T15:00:00.000Z', usage: { total_tokens: 50 } }
    ])
    const result = computeDailyUsage(messages)
    expect(result).toEqual([
      { date: '2026-06-01', messageCount: 2, totalTokens: 100 },
      { date: '2026-06-02', messageCount: 1, totalTokens: 0 },
      { date: '2026-06-03', messageCount: 1, totalTokens: 50 }
    ])
  })

  it('skips invalid timestamps', () => {
    const { messages } = makeMessages([
      { id: 'a', role: 'user', createdAt: 'not-a-date' },
      { id: 'b', role: 'user', createdAt: '2026-06-01T10:00:00.000Z' }
    ])
    const result = computeDailyUsage(messages)
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe('2026-06-01')
  })
})

// ---------------------------------------------------------------------------
// computeTopicStats (top-level)
// ---------------------------------------------------------------------------

describe('computeTopicStats', () => {
  it('computes the full aggregated payload for a mixed message set', () => {
    const { messages, blocks } = makeMessages([
      {
        id: 'u1',
        role: 'user',
        createdAt: '2026-06-01T10:00:00.000Z',
        blocks: [{ type: MessageBlockType.MAIN_TEXT, content: 'Hello 你好' }]
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-06-01T10:00:05.000Z',
        model: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, thoughts_tokens: 2 },
        metrics: { time_first_token_millsec: 100, time_completion_millsec: 1000, completion_tokens: 20 },
        blocks: [{ type: MessageBlockType.MAIN_TEXT, content: 'World 世界' }]
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: '2026-06-01T10:00:10.000Z',
        model: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
        usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40, thoughts_tokens: 3 },
        metrics: { time_first_token_millsec: 200, time_completion_millsec: 1000, completion_tokens: 25 },
        blocks: [{ type: MessageBlockType.MAIN_TEXT, content: 'foo bar baz' }]
      }
    ])

    const stats = computeTopicStats(messages, blocks)

    // Counts
    expect(stats.messageCount).toBe(3)
    expect(stats.userMessageCount).toBe(1)
    expect(stats.assistantMessageCount).toBe(2)
    expect(stats.systemMessageCount).toBe(0)

    // Tokens
    expect(stats.inputTokens).toBe(25)
    expect(stats.outputTokens).toBe(45)
    expect(stats.thinkingTokens).toBe(5)
    expect(stats.totalTokens).toBe(70)

    // Text metrics
    // 'Hello 你好' (1 Latin + 2 CJK = 3) + 'World 世界' (1 + 2 = 3) + 'foo bar baz' (3) = 9
    expect(stats.totalCharacters).toBe('Hello 你好'.length + 'World 世界'.length + 'foo bar baz'.length)
    expect(stats.totalWords).toBe(3 + 3 + 3) // CJK counted per char

    // Duration: 5s + 5s = 10s
    expect(stats.durationMs).toBe(10_000)
    expect(stats.firstMessageAt).toBe('2026-06-01T10:00:00.000Z')
    expect(stats.lastMessageAt).toBe('2026-06-01T10:00:10.000Z')

    // Performance
    expect(stats.performance.avgFirstTokenMs).toBe(150) // (100+200)/2
    expect(stats.performance.measuredMessages).toBe(2)

    // Model usage: 1 group, GPT-4o
    expect(stats.modelUsage).toHaveLength(1)
    const gpt = stats.modelUsage[0]
    expect(gpt.modelId).toBe('gpt-4o')
    expect(gpt.messageCount).toBe(2)
    expect(gpt.inputTokens).toBe(25)
    expect(gpt.outputTokens).toBe(45)

    // Daily usage: 1 day
    expect(stats.dailyUsage).toHaveLength(1)
    expect(stats.dailyUsage[0].date).toBe('2026-06-01')
    expect(stats.dailyUsage[0].messageCount).toBe(3)
  })

  it('handles empty input', () => {
    const stats = computeTopicStats([], new Map())
    expect(stats.messageCount).toBe(0)
    expect(stats.totalTokens).toBe(0)
    expect(stats.durationMs).toBe(0)
    expect(stats.firstMessageAt).toBeNull()
    expect(stats.lastMessageAt).toBeNull()
    expect(stats.modelUsage).toEqual([])
    expect(stats.dailyUsage).toEqual([])
    expect(stats.performance.measuredMessages).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// formatLocalDate / formatDurationParts
// ---------------------------------------------------------------------------

describe('formatLocalDate', () => {
  it('formats a valid ISO timestamp as YYYY-MM-DD in local time', () => {
    // 2026-06-07T00:00:00Z -> local date depends on TZ, so just check shape
    const result = formatLocalDate('2026-06-07T00:00:00.000Z')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns null for invalid / empty input', () => {
    expect(formatLocalDate('')).toBeNull()
    expect(formatLocalDate('not-a-date')).toBeNull()
  })
})

describe('formatDurationParts', () => {
  it('decomposes milliseconds into days/hours/minutes', () => {
    expect(formatDurationParts(0)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(formatDurationParts(60_000)).toEqual({ days: 0, hours: 0, minutes: 1 })
    expect(formatDurationParts(60 * 60_000)).toEqual({ days: 0, hours: 1, minutes: 0 })
    expect(formatDurationParts(24 * 60 * 60_000)).toEqual({ days: 1, hours: 0, minutes: 0 })
    expect(formatDurationParts((25 * 60 + 30) * 60_000)).toEqual({ days: 1, hours: 1, minutes: 30 })
  })

  it('clamps negative / non-finite values to zero', () => {
    expect(formatDurationParts(-100)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(formatDurationParts(Number.NaN)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(formatDurationParts(Number.POSITIVE_INFINITY)).toEqual({ days: 0, hours: 0, minutes: 0 })
  })
})
