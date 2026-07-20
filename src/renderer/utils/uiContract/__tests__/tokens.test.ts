import { describe, expect, it } from 'vitest'

import { parseUiTokens, uiSelector, uiTokens } from '../tokens'

describe('data-ui tokens', () => {
  it('serializes every concern into one canonical attribute', () => {
    const value = uiTokens('chat.message', {
      exactId: 'ui-abcdef0123456789',
      parts: ['message-content'],
      scopes: ['message:m_817']
    })

    expect(value).toBe('chat.message part:message-content id:ui-abcdef0123456789 scope:message:m_817')
    expect(parseUiTokens(value)).toMatchObject({
      exactId: 'ui-abcdef0123456789',
      parts: ['message-content'],
      scopes: ['message:m_817'],
      semanticId: 'chat.message'
    })
  })

  it('builds exact token selectors without DOM structure coupling', () => {
    expect(
      uiSelector({
        parts: ['message-content'],
        scopes: ['message:m_817'],
        semanticId: 'chat.message'
      })
    ).toBe('[data-ui~="chat.message"][data-ui~="part:message-content"][data-ui~="scope:message:m_817"]')
  })
})
