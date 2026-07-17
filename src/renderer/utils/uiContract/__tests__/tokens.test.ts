import { describe, expect, it } from 'vitest'

import { parseUiTokens, uiSelector, uiTokens } from '../tokens'

describe('data-ui tokens', () => {
  it('serializes every concern into one canonical attribute', () => {
    const value = uiTokens('chat.message', {
      exactId: 'uabcdef0',
      modes: ['compact'],
      scopes: ['message:m_817'],
      states: ['assistant', 'complete'],
      themes: ['custom'],
      variants: ['bubble']
    })

    expect(value).toBe(
      'chat.message id:uabcdef0 scope:message:m_817 variant:bubble mode:compact state:assistant state:complete theme:custom'
    )
    expect(parseUiTokens(value)).toMatchObject({
      exactId: 'uabcdef0',
      scopes: ['message:m_817'],
      semanticId: 'chat.message',
      states: ['assistant', 'complete']
    })
  })

  it('builds exact token selectors without DOM structure coupling', () => {
    expect(uiSelector({ semanticId: 'chat.message', scopes: ['message:m_817'], states: ['complete'] })).toBe(
      '[data-ui~="chat.message"][data-ui~="scope:message:m_817"][data-ui~="state:complete"]'
    )
  })
})
