import { describe, expect, expectTypeOf, it } from 'vitest'

import { parseUiTokens, uiSelector, type UiTokenOptions, uiTokens } from '../tokens'

describe('data-ui tokens', () => {
  it('limits authored tokens to runtime scopes', () => {
    expectTypeOf<keyof UiTokenOptions>().toEqualTypeOf<'scopes'>()
  })

  it('serializes semantic identity and runtime scopes', () => {
    const value = uiTokens('chat.message', {
      scopes: ['message:m_817']
    })

    expect(value).toBe('chat.message scope:message:m_817')
    expect(parseUiTokens(value)).toEqual({
      parts: [],
      scopes: ['message:m_817'],
      semanticId: 'chat.message'
    })
  })

  it('parses compiler-owned exact IDs and statically authored parts', () => {
    expect(parseUiTokens('chat.message part:message-content id:ui-abcdef0123456789 scope:message:m_817')).toEqual({
      exactId: 'ui-abcdef0123456789',
      parts: ['message-content'],
      scopes: ['message:m_817'],
      semanticId: 'chat.message'
    })
  })

  it('builds exact token selectors without DOM structure coupling', () => {
    expect(
      uiSelector({
        exactId: 'ui-abcdef0123456789',
        parts: ['message-content'],
        scopes: ['message:m_817'],
        semanticId: 'chat.message'
      })
    ).toBe(
      '[data-ui~="chat.message"][data-ui~="part:message-content"][data-ui~="id:ui-abcdef0123456789"][data-ui~="scope:message:m_817"]'
    )
  })
})
