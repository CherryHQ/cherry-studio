import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { sharedMessageToUIMessage, uiMessagesToPartsMap } from '../messageProjection'

describe('uiMessagesToPartsMap', () => {
  it.each(['constructor', '__proto__', 'toString'])('preserves own parts for a message named %s', (id) => {
    const parts: CherryMessagePart[] = [{ type: 'text', text: 'Imported message' }]
    const messages: CherryUIMessage[] = [
      { id, role: 'user', parts },
      { id: 'empty', role: 'user', parts: [] }
    ]
    Object.freeze(parts)
    Object.freeze(messages)

    const result = uiMessagesToPartsMap(messages)

    expect(Object.hasOwn(result, id)).toBe(true)
    expect(result[id]).toBe(parts)
    expect(Object.hasOwn(result, 'empty')).toBe(false)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})

describe('sharedMessageToUIMessage', () => {
  it('projects persisted retry settings into UI metadata', () => {
    const message = sharedMessageToUIMessage({
      id: 'assistant-1',
      topicId: 'topic-1',
      parentId: 'user-1',
      role: 'assistant',
      data: {
        parts: [],
        modelSelection: 'explicit',
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
    expect(message.metadata?.modelSelection).toBe('explicit')
  })
})
