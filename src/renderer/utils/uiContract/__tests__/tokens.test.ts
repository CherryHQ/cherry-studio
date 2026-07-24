import { describe, expect, it } from 'vitest'

import { parseUiTokens, uiSelector } from '../tokens'

describe('data-ui tokens', () => {
  it('parses semantic and structural selector tokens', () => {
    expect(parseUiTokens('chat.message part:message-content')).toEqual({
      parts: ['message-content'],
      semanticId: 'chat.message'
    })
  })

  it('builds semantic token selectors without DOM structure coupling', () => {
    expect(
      uiSelector({
        parts: ['message-content'],
        semanticId: 'chat.message'
      })
    ).toBe('[data-ui~="chat.message"][data-ui~="part:message-content"]')
  })
})
