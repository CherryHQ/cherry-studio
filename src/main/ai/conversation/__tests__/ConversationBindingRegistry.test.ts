import { ConversationKind, ConversationOpenTrigger, toConversationInputId } from '@shared/ai/conversation'
import { describe, expect, it } from 'vitest'

import type { MainDispatchRequest } from '../../streamManager'
import { ConversationBindingRegistry } from '../ConversationBindingRegistry'

describe('ConversationBindingRegistry', () => {
  it('stores an isolated deeply frozen request snapshot', () => {
    const registry = new ConversationBindingRegistry()
    const inputId = toConversationInputId('input-1')
    const textPart = { type: 'text' as const, text: 'before' }
    const request: MainDispatchRequest = {
      trigger: ConversationOpenTrigger.SubmitMessage,
      conversation: { kind: ConversationKind.Chat, id: 'topic-1' },
      userMessageParts: [textPart]
    }

    registry.setInput(inputId, { request })
    textPart.text = 'after'

    const snapshot = registry.input(inputId)?.request
    if (snapshot?.trigger !== ConversationOpenTrigger.SubmitMessage) throw new Error('submit snapshot missing')
    expect(snapshot?.userMessageParts).toEqual([{ type: 'text', text: 'before' }])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot?.userMessageParts)).toBe(true)
    expect(Object.isFrozen(snapshot?.userMessageParts?.[0])).toBe(true)
  })

  it('rejects a callback-bearing input instead of hiding an opaque resource in the registry', () => {
    const registry = new ConversationBindingRegistry()

    expect(() =>
      registry.setInput(toConversationInputId('input-1'), {
        request: {
          trigger: ConversationOpenTrigger.SubmitMessage,
          conversation: { kind: ConversationKind.Chat, id: 'topic-1' },
          userMessageParts: [],
          callback: () => {}
        } as never
      })
    ).toThrow()
  })
})
