import { describe, expect, it } from 'vitest'

import { commandSuggestion, createCommandSuggestion } from '../command'

describe('commandSuggestion render', () => {
  it('exposes a render lifecycle with keyboard handling', () => {
    expect(commandSuggestion.render).toBeDefined()
    expect(typeof commandSuggestion.render).toBe('function')

    const renderResult = commandSuggestion.render?.()
    expect(renderResult).toBeDefined()
    expect(renderResult?.onKeyDown).toBeDefined()
    expect(typeof renderResult?.onKeyDown).toBe('function')
  })

  it('omits the image command when images are disabled', async () => {
    const suggestion = createCommandSuggestion({ enableImageInsertion: false })
    const items = (await suggestion.items?.({ query: 'image' } as never)) ?? []

    expect(items.some((item) => item.id === 'image')).toBe(false)
  })

  it('keeps the image command enabled by default', async () => {
    const items = (await commandSuggestion.items?.({ query: 'image' } as never)) ?? []

    expect(items.some((item) => item.id === 'image')).toBe(true)
  })
})
