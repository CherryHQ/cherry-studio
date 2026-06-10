import type { CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { toMessageListItem } from '../messageListItem'

describe('toMessageListItem', () => {
  it('projects branch metadata and assistant model fallback into list items', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [],
      metadata: {
        parentId: 'user-1',
        siblingsGroupId: 2,
        isActiveBranch: true,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    } as CherryUIMessage

    expect(
      toMessageListItem(message, {
        topicId: 'topic-1',
        assistantId: 'assistant-1',
        modelFallback: {
          id: 'gpt-5.2',
          name: 'GPT-5.2',
          provider: 'openai'
        }
      })
    ).toMatchObject({
      id: 'message-1',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      parentId: 'user-1',
      siblingsGroupId: 2,
      isActiveBranch: true,
      modelId: 'openai::gpt-5.2',
      modelSnapshot: {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        provider: 'openai'
      }
    })
  })

  it('projects live top-level token metadata into message stats', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [],
      metadata: {
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        totalTokens: 20,
        promptTokens: 10,
        completionTokens: 5,
        thoughtsTokens: 5
      }
    } as CherryUIMessage

    expect(toMessageListItem(message, { topicId: 'topic-1' }).stats).toEqual({
      totalTokens: 20,
      promptTokens: 10,
      completionTokens: 5,
      thoughtsTokens: 5
    })
  })

  it('lets live token metadata override persisted stats while streaming', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [],
      metadata: {
        status: 'pending',
        stats: { thoughtsTokens: 100 },
        thoughtsTokens: 150
      }
    } as CherryUIMessage

    expect(toMessageListItem(message, { topicId: 'topic-1' }).stats?.thoughtsTokens).toBe(150)
  })
})
