import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { normalizeLoadedBlocks, normalizeLoadedMessages } from '../normalizeLoadedData'

describe('normalizeLoadedBlocks', () => {
  it('should normalize STREAMING block statuses to SUCCESS', () => {
    const blocks = [
      {
        id: 'block-1',
        messageId: 'msg-1',
        type: MessageBlockType.THINKING,
        status: MessageBlockStatus.STREAMING,
        content: 'Thinking...',
        createdAt: new Date().toISOString()
      },
      {
        id: 'block-2',
        messageId: 'msg-1',
        type: MessageBlockType.MAIN_TEXT,
        status: MessageBlockStatus.SUCCESS,
        content: 'Hello',
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedBlocks(blocks)

    expect(result[0].status).toBe(MessageBlockStatus.SUCCESS)
    expect(result[1].status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should normalize PROCESSING block statuses to SUCCESS', () => {
    const blocks = [
      {
        id: 'block-1',
        messageId: 'msg-1',
        type: MessageBlockType.MAIN_TEXT,
        status: MessageBlockStatus.PROCESSING,
        content: 'Processing...',
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedBlocks(blocks)

    expect(result[0].status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should normalize PENDING block statuses to SUCCESS', () => {
    const blocks = [
      {
        id: 'block-1',
        messageId: 'msg-1',
        type: MessageBlockType.TOOL,
        status: MessageBlockStatus.PENDING,
        content: 'Pending tool call...',
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedBlocks(blocks)

    expect(result[0].status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should preserve ERROR and PAUSED block statuses', () => {
    const blocks = [
      {
        id: 'block-error',
        messageId: 'msg-1',
        type: MessageBlockType.ERROR,
        status: MessageBlockStatus.ERROR,
        content: 'Error',
        createdAt: new Date().toISOString()
      },
      {
        id: 'block-paused',
        messageId: 'msg-1',
        type: MessageBlockType.MAIN_TEXT,
        status: MessageBlockStatus.PAUSED,
        content: 'Paused',
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedBlocks(blocks)

    expect(result[0].status).toBe(MessageBlockStatus.ERROR)
    expect(result[1].status).toBe(MessageBlockStatus.PAUSED)
  })

  it('should not mutate original block objects', () => {
    const originalBlock = {
      id: 'block-1',
      messageId: 'msg-1',
      type: MessageBlockType.THINKING,
      status: MessageBlockStatus.STREAMING,
      content: 'Thinking...',
      createdAt: new Date().toISOString()
    }

    const result = normalizeLoadedBlocks([originalBlock])

    expect(originalBlock.status).toBe(MessageBlockStatus.STREAMING)
    expect(result[0].status).toBe(MessageBlockStatus.SUCCESS)
  })
})

describe('normalizeLoadedMessages', () => {
  it('should normalize PROCESSING assistant message statuses to SUCCESS', () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: AssistantMessageStatus.PROCESSING,
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedMessages(messages)

    expect(result[0].status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('should normalize PENDING assistant message statuses to SUCCESS', () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: AssistantMessageStatus.PENDING,
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedMessages(messages)

    expect(result[0].status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('should normalize SEARCHING assistant message statuses to SUCCESS', () => {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: AssistantMessageStatus.SEARCHING,
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedMessages(messages)

    expect(result[0].status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('should preserve SUCCESS, PAUSED, and ERROR message statuses', () => {
    const messages = [
      {
        id: 'msg-success',
        role: 'assistant' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: AssistantMessageStatus.SUCCESS,
        createdAt: new Date().toISOString()
      },
      {
        id: 'msg-paused',
        role: 'assistant' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: AssistantMessageStatus.PAUSED,
        createdAt: new Date().toISOString()
      },
      {
        id: 'msg-error',
        role: 'assistant' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        status: AssistantMessageStatus.ERROR,
        createdAt: new Date().toISOString()
      }
    ]

    const result = normalizeLoadedMessages(messages)

    expect(result[0].status).toBe(AssistantMessageStatus.SUCCESS)
    expect(result[1].status).toBe(AssistantMessageStatus.PAUSED)
    expect(result[2].status).toBe(AssistantMessageStatus.ERROR)
  })

  it('should not mutate original message objects', () => {
    const originalMessage = {
      id: 'msg-1',
      role: 'assistant' as const,
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      status: AssistantMessageStatus.PROCESSING,
      createdAt: new Date().toISOString()
    }

    const result = normalizeLoadedMessages([originalMessage])

    expect(originalMessage.status).toBe(AssistantMessageStatus.PROCESSING)
    expect(result[0].status).toBe(AssistantMessageStatus.SUCCESS)
  })
})
