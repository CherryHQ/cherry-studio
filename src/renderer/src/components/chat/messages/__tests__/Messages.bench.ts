import { AssistantMessageStatus, type Message, UserMessageStatus } from '@renderer/types/newMessage'
import { bench, describe, expect, test } from 'vitest'

// ============================================================================
// 1. 编写用于对比的算法
// ============================================================================

// 旧版本作为基线：包含 [...messages].reverse()
const baseline = (messages: Message[], startIndex: number, displayCount: number) => {
  const reversedMessages = [...messages].reverse()

  if (reversedMessages.length - startIndex <= displayCount) {
    return reversedMessages.slice(startIndex)
  }

  const userIdSet = new Set<string>()
  const assistantIdSet = new Set<string>()
  const displayMessages: Message[] = []

  const processMessage = (message: Message) => {
    if (!message) return
    const idSet = message.role === 'user' ? userIdSet : assistantIdSet
    const messageId = message.role === 'user' ? message.id : message.askId

    if (!idSet.has(messageId!)) {
      idSet.add(messageId!)
      displayMessages.push(message)
      return
    }
    displayMessages.push(message)
  }

  for (let i = startIndex; i < reversedMessages.length && userIdSet.size + assistantIdSet.size < displayCount; i++) {
    processMessage(reversedMessages[i])
  }

  return displayMessages
}

// 新版本：直接使用原生索引倒序遍历
const byBackwardIndex = (messages: Message[], startIndex: number, displayCount: number) => {
  if (messages.length - startIndex <= displayCount) {
    const result: Message[] = []
    for (let i = messages.length - 1 - startIndex; i >= 0; i--) {
      result.push(messages[i])
    }
    return result
  }

  const userIdSet = new Set<string>()
  const assistantIdSet = new Set<string>()
  const displayMessages: Message[] = []

  const processMessage = (message: Message) => {
    if (!message) return
    const idSet = message.role === 'user' ? userIdSet : assistantIdSet
    const messageId = message.role === 'user' ? message.id : message.askId

    if (!idSet.has(messageId!)) {
      idSet.add(messageId!)
      displayMessages.push(message)
      return
    }
    displayMessages.push(message)
  }

  for (let i = messages.length - 1 - startIndex; i >= 0 && userIdSet.size + assistantIdSet.size < displayCount; i--) {
    processMessage(messages[i])
  }

  return displayMessages
}

// ============================================================================
// 2. 构造测试数据，并验证算法结果一致性
// ============================================================================

// 使用固定时间戳
const generateMockMessages = (count: number): Message[] => {
  const BASE_TIMESTAMP = 1700000000000
  const messages: Message[] = []

  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0
    messages.push({
      id: `msg-${i}`,
      role: isUser ? 'user' : 'assistant',
      assistantId: 'mock-assistant',
      topicId: 'mock-topic',
      createdAt: new Date(BASE_TIMESTAMP + i * 1000).toISOString(),
      status: isUser ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,

      blocks: [],
      askId: isUser ? undefined : `msg-${i - 1}`
    } satisfies Message)
  }

  return messages
}

// 场景：不同消息数量
const SCENARIOS = [100, 1000, 10000] as const
const mockDataMap = Object.fromEntries(SCENARIOS.map((n) => [n, generateMockMessages(n)])) as Record<
  (typeof SCENARIOS)[number],
  Message[]
>

// 测试结果是否一致
test('computeOld and computeNew should produce identical results', () => {
  const sample = mockDataMap[100]
  expect(baseline(sample, 0, 20)).toEqual(byBackwardIndex(sample, 0, 20))
})

// ============================================================================
// 3. 基准测试
// ============================================================================

// Benchmark 配置
const benchOptions = (overrides = {}) => ({
  iterations: 1000,
  warmupIterations: 200,
  ...overrides
})

describe('computeDisplayMessages Performance', () => {
  SCENARIOS.forEach((totalCount) => {
    describe(`${totalCount} messages`, () => {
      const mockData = mockDataMap[totalCount]

      bench(
        'spread + reverse (O(n) copy)',
        () => {
          baseline(mockData, 0, 20)
        },
        benchOptions()
      )

      bench(
        'in-place backward index (no copy)',
        () => {
          byBackwardIndex(mockData, 0, 20)
        },
        benchOptions()
      )
    })
  })
})
