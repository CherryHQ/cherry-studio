import {
  AssistantMessageStatus,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import {
  buildPartsMap,
  findPrecedingUserMessage,
  findRootMessage,
  mergeHistoryAndLiveBlockMaps,
  mergeHistoryAndLiveMessages
} from '../v2ChatMessageUtils'

function createUIMessage(overrides: Partial<CherryUIMessage> & Pick<CherryUIMessage, 'id' | 'role'>): CherryUIMessage {
  return {
    id: overrides.id,
    role: overrides.role,
    parts: overrides.parts ?? [],
    metadata: overrides.metadata,
    ...('createdAt' in overrides && { createdAt: overrides.createdAt }),
    ...('content' in overrides && { content: overrides.content })
  } as CherryUIMessage
}

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return {
    id: overrides.id,
    role: overrides.role,
    assistantId: overrides.assistantId ?? 'assistant-1',
    topicId: overrides.topicId ?? 'topic-1',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    status:
      overrides.status ?? (overrides.role === 'assistant' ? AssistantMessageStatus.SUCCESS : UserMessageStatus.SUCCESS),
    blocks: overrides.blocks ?? [],
    askId: overrides.askId,
    updatedAt: overrides.updatedAt,
    modelId: overrides.modelId,
    model: overrides.model,
    type: overrides.type,
    useful: overrides.useful,
    mentions: overrides.mentions,
    enabledMCPs: overrides.enabledMCPs,
    usage: overrides.usage,
    metrics: overrides.metrics,
    multiModelMessageStyle: overrides.multiModelMessageStyle,
    foldSelected: overrides.foldSelected,
    traceId: overrides.traceId
  }
}

function createBlock(id: string, messageId: string): MessageBlock {
  return {
    id,
    messageId,
    type: MessageBlockType.MAIN_TEXT,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: MessageBlockStatus.SUCCESS,
    content: `content-${id}`
  }
}

describe('findPrecedingUserMessage', () => {
  it('returns the user message immediately before the assistant message', () => {
    const user = createUIMessage({ id: 'user-1', role: 'user' })
    const assistant = createUIMessage({ id: 'assistant-1', role: 'assistant' })

    const result = findPrecedingUserMessage([user, assistant], assistant.id)

    expect(result).toBe(user)
  })

  it('returns undefined when assistant message is the first message', () => {
    const assistant = createUIMessage({ id: 'assistant-1', role: 'assistant' })

    const result = findPrecedingUserMessage([assistant], assistant.id)

    expect(result).toBeUndefined()
  })

  it('returns undefined when the preceding message is not a user message', () => {
    const previousAssistant = createUIMessage({ id: 'assistant-0', role: 'assistant' })
    const assistant = createUIMessage({ id: 'assistant-1', role: 'assistant' })

    const result = findPrecedingUserMessage([previousAssistant, assistant], assistant.id)

    expect(result).toBeUndefined()
  })

  it('returns undefined when the assistant message does not exist', () => {
    const user = createUIMessage({ id: 'user-1', role: 'user' })

    const result = findPrecedingUserMessage([user], 'missing-assistant')

    expect(result).toBeUndefined()
  })
})

describe('mergeHistoryAndLiveMessages', () => {
  it('returns the original history array when there are no live messages', () => {
    const historyMessages = [createMessage({ id: 'history-1', role: 'user' })]

    const result = mergeHistoryAndLiveMessages(historyMessages, [])

    expect(result).toBe(historyMessages)
  })

  it('appends live messages after history messages', () => {
    const historyMessages = [createMessage({ id: 'history-1', role: 'user' })]
    const liveMessages = [createMessage({ id: 'live-1', role: 'assistant' })]

    const result = mergeHistoryAndLiveMessages(historyMessages, liveMessages)

    expect(result).toEqual([...historyMessages, ...liveMessages])
  })
})

describe('mergeHistoryAndLiveBlockMaps', () => {
  it('returns the original history block map when there are no live blocks', () => {
    const historyBlockMap = { 'block-1': createBlock('block-1', 'message-1') }

    const result = mergeHistoryAndLiveBlockMaps(historyBlockMap, {})

    expect(result).toBe(historyBlockMap)
  })

  it('merges live blocks on top of history blocks', () => {
    const historyBlockMap = { 'block-1': createBlock('block-1', 'message-1') }
    const liveBlockMap = { 'block-2': createBlock('block-2', 'message-2') }

    const result = mergeHistoryAndLiveBlockMaps(historyBlockMap, liveBlockMap)

    expect(result).toEqual({
      ...historyBlockMap,
      ...liveBlockMap
    })
  })
})

describe('buildPartsMap', () => {
  it('returns the original history parts map when there are no live messages', () => {
    const historyPartsMap: Record<string, CherryMessagePart[]> = {
      'message-1': [{ type: 'text', text: 'history' }]
    }

    const result = buildPartsMap(historyPartsMap, [])

    expect(result).toBe(historyPartsMap)
  })

  it('adds live message parts into a new parts map', () => {
    const historyPartsMap: Record<string, CherryMessagePart[]> = {
      'message-1': [{ type: 'text', text: 'history' }]
    }
    const liveMessage = createUIMessage({
      id: 'message-2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'live' }]
    })

    const result = buildPartsMap(historyPartsMap, [liveMessage])

    expect(result).toEqual({
      'message-1': [{ type: 'text', text: 'history' }],
      'message-2': [{ type: 'text', text: 'live' }]
    })
    expect(result).not.toBe(historyPartsMap)
  })
})

describe('findRootMessage', () => {
  it('returns the first message without askId', () => {
    const rootMessage = createMessage({ id: 'root', role: 'user' })
    const childMessage = createMessage({ id: 'child', role: 'assistant', askId: 'root' })

    const result = findRootMessage([rootMessage, childMessage])

    expect(result).toBe(rootMessage)
  })

  it('returns undefined when every message has askId', () => {
    const childMessage = createMessage({ id: 'child', role: 'assistant', askId: 'root' })

    const result = findRootMessage([childMessage])

    expect(result).toBeUndefined()
  })
})
