import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { describe, expect, it, vi } from 'vitest'

import { insertSlashCommand } from '../definitions/slashCommandsTool'

describe('slash command tool', () => {
  it('inserts through the rich composer input adapter after QuickPanel consumes the query', () => {
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => '/cl',
      getCursorOffset: () => 3,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    const onTextChange = vi.fn()

    insertSlashCommand('/clear', onTextChange, inputAdapter)

    expect(inputAdapter.deleteTriggerRange).not.toHaveBeenCalled()
    expect(inputAdapter.insertText).toHaveBeenCalledWith('/clear ')
    expect(inputAdapter.focus).toHaveBeenCalled()
    expect(onTextChange).not.toHaveBeenCalled()
  })

  it('inserts at the adapter cursor when opened from a button', () => {
    const inputAdapter: QuickPanelInputAdapter = {
      getText: () => 'hello',
      getCursorOffset: () => 5,
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    insertSlashCommand('/clear', vi.fn(), inputAdapter)

    expect(inputAdapter.deleteTriggerRange).not.toHaveBeenCalled()
    expect(inputAdapter.insertText).toHaveBeenCalledWith('/clear ')
    expect(inputAdapter.focus).toHaveBeenCalled()
  })
})
