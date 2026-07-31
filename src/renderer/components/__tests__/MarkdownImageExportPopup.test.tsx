// The popup's contract (mode state + resolution semantics) is the subject here; the
// Dialog chrome is a local call-recording boundary, mirroring ConfirmPopupItem.test.tsx.
vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const RadioGroupContext = React.createContext<{ value?: string; onValueChange?: (v: string) => void }>({})

  return {
    Button: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('button', props, children as never),
    Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
      open ? React.createElement(React.Fragment, null, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { role: 'dialog' }, children),
    DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('h2', null, children),
    RadioGroup: ({
      value,
      onValueChange,
      children,
      ...props
    }: {
      value?: string
      onValueChange?: (v: string) => void
      children: React.ReactNode
    }) =>
      React.createElement(
        RadioGroupContext.Provider,
        { value: { value, onValueChange } },
        React.createElement('div', { role: 'radiogroup', ...props }, children)
      ),
    RadioGroupItem: ({ value }: { value: string }) => {
      const group = React.use(RadioGroupContext)
      return React.createElement('input', {
        type: 'radio',
        value,
        checked: group.value === value,
        onChange: () => group.onValueChange?.(value),
        'aria-label': value
      })
    }
  }
})

// Deterministic i18n: keys (plus interpolated count) are the visible contract here.
vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.count ?? ''}` }
}))

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MarkdownImageExportPopup from '@renderer/components/MarkdownImageExportPopup'
import { PopupHost } from '@renderer/components/PopupHost'

afterEach(cleanup)

describe('MarkdownImageExportPopup', () => {
  it('shows the image count and defaults to embed', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    void MarkdownImageExportPopup.show({ imageCount: 3 })

    expect(await screen.findByText(/image_mode\.count:3/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'embed' })).toBeChecked()
    // settle the popup so later shows are not single-flight-blocked
    await user.click(screen.getByRole('button', { name: 'common.cancel:' }))
  })

  it('resolves the picked mode on confirm', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    const shown = MarkdownImageExportPopup.show({ imageCount: 1 })

    await screen.findByRole('radiogroup')
    await user.click(screen.getByRole('radio', { name: 'folder' }))
    await user.click(screen.getByRole('button', { name: 'common.confirm:' }))

    await expect(shown).resolves.toBe('folder')
  })

  it('resolves null when cancelled', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    const shown = MarkdownImageExportPopup.show({ imageCount: 1 })

    await screen.findByRole('radiogroup')
    await user.click(screen.getByRole('button', { name: 'common.cancel:' }))

    await expect(shown).resolves.toBeNull()
  })
})
