import { describe, expect, it } from 'vitest'

import { commandSuggestion } from '../command'

describe('commandSuggestion render', () => {
  it('exposes a render lifecycle with keyboard handling', () => {
    expect(commandSuggestion.render).toBeDefined()
    expect(typeof commandSuggestion.render).toBe('function')

    const renderResult = commandSuggestion.render?.()
    expect(renderResult).toBeDefined()
    expect(renderResult?.onKeyDown).toBeDefined()
    expect(typeof renderResult?.onKeyDown).toBe('function')
  })
})
