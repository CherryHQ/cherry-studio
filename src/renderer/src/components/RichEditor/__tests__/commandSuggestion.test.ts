import { describe, expect, it } from 'vitest'

import { commandSuggestion } from '../command'

describe('commandSuggestion render', () => {
  it('has render function', () => {
    expect(commandSuggestion.render).toBeDefined()
    expect(typeof commandSuggestion.render).toBe('function')
  })

  it('render function returns object with onKeyDown', () => {
    const renderResult = commandSuggestion.render?.()
    expect(renderResult).toBeDefined()
    expect(renderResult?.onKeyDown).toBeDefined()
    expect(typeof renderResult?.onKeyDown).toBe('function')
  })
})
