import type { CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '../../types'
import { getDirectAssistantModelsByUserId, toMessageListItem } from '../messageListItem'

describe('toMessageListItem', () => {
  it('projects the top-level totalTokens mirror into message stats', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [],
      metadata: {
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        totalTokens: 20
      }
    } as CherryUIMessage

    expect(toMessageListItem(message, { topicId: 'topic-1' }).stats).toEqual({ totalTokens: 20 })
  })

  it('lets the top-level totalTokens mirror override persisted stats while streaming', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [],
      metadata: {
        status: 'pending',
        stats: { totalTokens: 100 },
        totalTokens: 150
      }
    } as CherryUIMessage

    expect(toMessageListItem(message, { topicId: 'topic-1' }).stats?.totalTokens).toBe(150)
  })

  it('resolves a snapshot-less row from its own frozen modelId', () => {
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [],
      metadata: { status: 'success', modelId: 'openai::gpt-4o' }
    } as CherryUIMessage

    const item = toMessageListItem(message, { topicId: 'topic-1' })

    expect(item.model).toEqual({ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai' })
    expect(item.modelId).toBe('openai::gpt-4o')
  })

  it('leaves the model undefined when the row has neither snapshot nor modelId (no live fallback)', () => {
    const message = { id: 'm2', role: 'assistant', parts: [], metadata: { status: 'success' } } as CherryUIMessage

    const item = toMessageListItem(message, { topicId: 'topic-1' })

    expect(item.model).toBeUndefined()
    expect(item.modelId).toBeUndefined()
  })
})

describe('getDirectAssistantModelsByUserId', () => {
  it('collects only direct assistant child models and falls back to model snapshots', () => {
    const user = {
      id: 'user-1',
      role: 'user',
      topicId: 'topic-1',
      parentId: 'root',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as MessageListItem
    const firstReply = {
      id: 'assistant-a',
      role: 'assistant',
      topicId: 'topic-1',
      parentId: 'user-1',
      createdAt: '2026-01-01T00:00:01.000Z',
      status: 'success',
      modelId: 'provider-a::model-a',
      model: { id: 'model-a', name: 'Model A', provider: 'provider-a' }
    } as MessageListItem
    const duplicateReply = {
      ...firstReply,
      id: 'assistant-a-duplicate',
      createdAt: '2026-01-01T00:00:02.000Z'
    } as MessageListItem
    const snapshotOnlyReply = {
      id: 'assistant-b',
      role: 'assistant',
      topicId: 'topic-1',
      parentId: 'user-1',
      createdAt: '2026-01-01T00:00:03.000Z',
      status: 'success',
      modelId: 'legacy-model-b',
      model: { id: 'model-b', name: 'Model B', provider: 'provider-b' }
    } as MessageListItem
    const followUpUser = {
      id: 'follow-up-user',
      role: 'user',
      topicId: 'topic-1',
      parentId: 'assistant-a',
      createdAt: '2026-01-01T00:00:04.000Z',
      status: 'success'
    } as MessageListItem
    const descendantReply = {
      id: 'assistant-c',
      role: 'assistant',
      topicId: 'topic-1',
      parentId: 'follow-up-user',
      createdAt: '2026-01-01T00:00:05.000Z',
      status: 'success',
      modelId: 'provider-c::model-c',
      model: { id: 'model-c', name: 'Model C', provider: 'provider-c' }
    } as MessageListItem

    const modelsByUserId = getDirectAssistantModelsByUserId([
      user,
      firstReply,
      duplicateReply,
      snapshotOnlyReply,
      followUpUser,
      descendantReply
    ])

    expect(modelsByUserId.get('user-1')).toEqual([
      expect.objectContaining({ id: 'provider-a::model-a', name: 'Model A', providerId: 'provider-a' }),
      expect.objectContaining({ id: 'provider-b::model-b', name: 'Model B', providerId: 'provider-b' })
    ])
    expect(modelsByUserId.get('user-1')).toHaveLength(2)
  })
})
