import { describe, expect, it } from 'vitest'

import { removeAtSymbolAndText } from '../textHelpers'

describe('textHelpers.removeAtSymbolAndText', () => {
  it('removes precise pattern when searchText provided', () => {
    const text = 'Hello @group Alpha and @group Beta'
    const caret = text.length
    const result = removeAtSymbolAndText(text, caret, 'group Beta', text.indexOf('@group Beta'))
    expect(result).toBe('Hello @group Alpha and ')
  })

  it('falls back to position when pattern not found', () => {
    const text = 'Say @helloWorld now'
    const caret = text.length
    const result = removeAtSymbolAndText(text, caret, 'hello', text.indexOf('@helloWorld'))
    // removes only the @ because actual pattern differs
    expect(result).toBe('Say helloWorld now')
  })

  it('removes nearest @ and subsequent non-whitespace when searchText omitted', () => {
    const text = 'Hi @modelX,test next'
    const caret = text.length
    const result = removeAtSymbolAndText(text, caret)
    expect(result).toBe('Hi  next')
  })
})
