import { describe, expect, it } from 'vitest'

import { sharedMessageToUIMessage } from '../messageProjection'

describe('sharedMessageToUIMessage', () => {
  it('projects persisted assistant turn options into UI metadata', () => {
    const message = sharedMessageToUIMessage({
      id: 'assistant-1',
      topicId: 'topic-1',
      parentId: 'user-1',
      role: 'assistant',
      data: {
        parts: [],
        turnOptions: { reasoningEffort: 'high', fastMode: true }
      },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0,
      modelId: 'provider::model',
      messageSnapshot: null,
      stats: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(message.metadata?.turnOptions).toEqual({ reasoningEffort: 'high', fastMode: true })
  })

  it('projects an author-less frozen model snapshot into UI metadata', () => {
    const modelSnapshot = {
      id: 'm2.1',
      name: 'MiniMax M2.1',
      provider: 'minimax',
      priorityMode: 'minimax' as const
    }
    const message = sharedMessageToUIMessage({
      id: 'assistant-1',
      topicId: 'topic-1',
      parentId: 'user-1',
      role: 'assistant',
      data: { parts: [], modelSnapshot },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0,
      modelId: 'minimax::m2.1',
      messageSnapshot: null,
      stats: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(message.metadata?.modelSnapshot).toEqual(modelSnapshot)
  })
})
