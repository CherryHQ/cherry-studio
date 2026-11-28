import { Type } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { CommandCategory, commandSuggestion, createCommandSuggestion, registerCommand } from '../command'

describe('commandSuggestion render', () => {
  it('omits the image command when images are disabled', async () => {
    const suggestion = createCommandSuggestion({ enableImageInsertion: false })
    const items = (await suggestion.items?.({ query: 'image' } as never)) ?? []

    expect(items.some((item) => item.id === 'image')).toBe(false)
  })

  it('does not execute a command from a stale popup once the editor is read-only', () => {
    const run = vi.fn()
    const deleteRange = vi.fn(() => ({ run }))
    const focus = vi.fn(() => ({ deleteRange }))
    const chain = vi.fn(() => ({ focus }))
    const handler = vi.fn()
    registerCommand({
      id: 'lockedEditorProbe',
      title: 'probe',
      description: 'probe',
      category: CommandCategory.SPECIAL,
      icon: Type,
      keywords: ['locked-editor-probe'],
      handler
    })
    const editor = { isEditable: false, chain }

    commandSuggestion.command?.({
      editor,
      range: { from: 0, to: 1 },
      props: { id: 'lockedEditorProbe' }
    } as never)

    expect(chain).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
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
