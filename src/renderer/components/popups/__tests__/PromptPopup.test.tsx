import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Box: ({ children, ...props }) => React.createElement('div', props, children),
    Button: ({ children, ...props }) => {
      delete props.variant
      delete props.size
      return React.createElement('button', props, children)
    },
    Dialog: ({ children, open }) => (open ? React.createElement(React.Fragment, null, children) : null),
    DialogContent: ({ children, ...props }) => {
      delete props.closeOnOverlayClick
      return React.createElement('div', { role: 'dialog', ...props }, children)
    },
    DialogFooter: ({ children, ...props }) => React.createElement('div', props, children),
    DialogHeader: ({ children, ...props }) => React.createElement('div', props, children),
    DialogTitle: ({ children, ...props }) => React.createElement('h2', props, children),
    Textarea: {
      Input: ({ ref, ...props }) => React.createElement('textarea', { ...props, ref })
    }
  }
})

import PromptPopup from '../PromptPopup'

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, null)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PromptPopup', () => {
  it('focuses the prompt without selecting its existing value', () => {
    vi.useFakeTimers()
    const setSelectionRange = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange')
    render(<PopupHost />)

    act(() => {
      void PromptPopup.show({
        title: 'Edit prompt',
        message: 'Prompt content',
        defaultValue: 'Keep this text'
      })
    })
    act(() => {
      vi.runOnlyPendingTimers()
    })

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea).toHaveFocus()
    expect(textarea).toHaveValue('Keep this text')
    expect(setSelectionRange).toHaveBeenCalledWith('Keep this text'.length, 'Keep this text'.length)
    expect(textarea.selectionStart).toBe('Keep this text'.length)
    expect(textarea.selectionEnd).toBe('Keep this text'.length)
  })
})
