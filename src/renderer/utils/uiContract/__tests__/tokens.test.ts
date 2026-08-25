import { describe, expect, it } from 'vitest'

import { parseUiTokens, uiSelector, type UiSelectorOptions } from '../tokens'

const invalidSelectors: Array<{
  error: string
  label: string
  options: UiSelectorOptions
}> = [
  {
    error: 'A data-ui selector requires at least one token',
    label: 'empty selector options',
    options: {}
  },
  {
    error: 'Invalid data-ui semantic ID',
    label: 'unsafe semantic IDs',
    options: { semanticId: 'chat.message"] *' }
  },
  {
    error: 'Invalid data-ui part token value',
    label: 'unsafe part tokens',
    options: { parts: ['message-content"] *'] }
  }
]

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

  it.each(invalidSelectors)('rejects $label', ({ error, options }) => {
    expect(() => uiSelector(options)).toThrow(error)
  })
})
