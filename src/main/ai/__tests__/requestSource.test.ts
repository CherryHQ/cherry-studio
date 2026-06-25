import { describe, expect, it } from 'vitest'

import {
  buildRequestSourceHeaders,
  CHERRY_CONVERSATION_ID_HEADER,
  CHERRY_SOURCE_HEADER,
  CherryRequestSource,
  isCherryinProviderId,
  toAnthropicCustomHeaders
} from '../requestSource'

describe('buildRequestSourceHeaders', () => {
  it('emits the source header and the conversation header when a conversation id is present', () => {
    expect(buildRequestSourceHeaders({ feature: CherryRequestSource.Chat, conversationId: 'topic-1' })).toEqual({
      [CHERRY_SOURCE_HEADER]: 'chat',
      [CHERRY_CONVERSATION_ID_HEADER]: 'topic-1'
    })
  })

  it('omits the conversation header for the stateless features', () => {
    expect(buildRequestSourceHeaders({ feature: CherryRequestSource.Translate })).toEqual({
      [CHERRY_SOURCE_HEADER]: 'translate'
    })
  })
})

describe('isCherryinProviderId', () => {
  it('is true only for the cherryin provider id', () => {
    expect(isCherryinProviderId('cherryin')).toBe(true)
    expect(isCherryinProviderId('openai')).toBe(false)
  })
})

describe('toAnthropicCustomHeaders', () => {
  it('serialises headers as newline-separated `Name: Value` lines', () => {
    expect(
      toAnthropicCustomHeaders({
        [CHERRY_SOURCE_HEADER]: 'agent',
        [CHERRY_CONVERSATION_ID_HEADER]: 'session-7'
      })
    ).toBe('X-Cherry-Source: agent\nX-Cherry-Conversation-Id: session-7')
  })
})
