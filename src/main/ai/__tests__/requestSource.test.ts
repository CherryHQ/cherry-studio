import { describe, expect, it } from 'vitest'

import {
  buildRequestSourceHeaders,
  CHERRY_CONVERSATION_ID_HEADER,
  CHERRY_SOURCE_HEADER,
  CherryRequestSource,
  isCherryinProviderId,
  parseRequestSourceHeaders,
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

describe('parseRequestSourceHeaders', () => {
  it('round-trips the headers built by buildRequestSourceHeaders', () => {
    const source = { feature: CherryRequestSource.Agent, conversationId: 'session-7' }
    const headers = new Headers(buildRequestSourceHeaders(source))
    expect(parseRequestSourceHeaders(headers)).toEqual(source)
  })

  it('omits the conversation id when the header is absent', () => {
    const headers = new Headers({ [CHERRY_SOURCE_HEADER]: 'knowledge' })
    expect(parseRequestSourceHeaders(headers)).toEqual({ feature: CherryRequestSource.Knowledge })
  })

  it('returns undefined when the source header is missing', () => {
    expect(parseRequestSourceHeaders(new Headers())).toBeUndefined()
  })

  it('returns undefined for an unrecognized source value (no bogus provenance)', () => {
    const headers = new Headers({ [CHERRY_SOURCE_HEADER]: 'not-a-feature', [CHERRY_CONVERSATION_ID_HEADER]: 'x' })
    expect(parseRequestSourceHeaders(headers)).toBeUndefined()
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
