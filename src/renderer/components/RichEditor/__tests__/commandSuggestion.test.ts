import { describe, expect, it } from 'vitest'

import { commandSuggestion, createCommandSuggestion } from '../command'

describe('commandSuggestion render', () => {
  it('omits the image command when images are disabled', async () => {
    const suggestion = createCommandSuggestion({ enableImageInsertion: false })
    const items = (await suggestion.items?.({ query: 'image' } as never)) ?? []

    expect(items.some((item) => item.id === 'image')).toBe(false)
  })

  it('hides configured commands without changing the shared command registry', async () => {
    const suggestion = createCommandSuggestion({ disabledCommands: ['inlineMath'] })
    const configuredItems = (await suggestion.items?.({ query: 'equation' } as never)) ?? []
    const defaultItems = (await commandSuggestion.items?.({ query: 'equation' } as never)) ?? []

    expect(configuredItems.some((item) => item.id === 'inlineMath')).toBe(false)
    expect(configuredItems.some((item) => item.id === 'blockMath')).toBe(true)
    expect(defaultItems.some((item) => item.id === 'inlineMath')).toBe(true)
  })
})
