import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
type MockChildrenProps = { children?: ReactNode }
type MockDialogProps = MockChildrenProps & { open?: boolean }
type MockDialogContentProps = MockChildrenProps & {
  onOpenAutoFocus?: (event: { defaultPrevented: boolean; preventDefault: () => void }) => void
  showCloseButton?: boolean
  size?: string
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'migration.window.confirm_close.title': 'Migration in progress',
        'migration.window.confirm_close.message': 'Quit anyway?',
        'migration.window.confirm_close.continue': 'Continue migration',
        'migration.window.confirm_close.quit': 'Quit anyway'
      })[key] ?? key
  })
}))

// Override the global passthrough Dialog mock with the Radix autofocus behavior under test.
vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Button: ({ children, disabled, variant, onClick, ...props }: MockButtonProps) =>
      React.createElement('button', { ...props, 'data-variant': variant, disabled, onClick }, children),
    Dialog: ({ children, open }: MockDialogProps) =>
      open ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null,
    DialogContent: ({ children, onOpenAutoFocus }: MockDialogContentProps) => {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (!node) return
        const event = {
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true
          }
        }
        onOpenAutoFocus?.(event)
        if (!event.defaultPrevented) {
          node.querySelector('button')?.focus()
        }
      }, [onOpenAutoFocus])
      return React.createElement('div', { ref, 'data-testid': 'dialog-content' }, children)
    },
    DialogDescription: ({ children }: MockChildrenProps) =>
      React.createElement('p', { 'data-testid': 'dialog-description' }, children),
    DialogFooter: ({ children }: MockChildrenProps) =>
      React.createElement('div', { 'data-testid': 'dialog-footer' }, children),
    DialogHeader: ({ children }: MockChildrenProps) =>
      React.createElement('div', { 'data-testid': 'dialog-header' }, children),
    DialogTitle: ({ children }: MockChildrenProps) =>
      React.createElement('h2', { 'data-testid': 'dialog-title' }, children)
  }
})

import { CloseMigrationDialog } from '../CloseMigrationDialog'

describe('CloseMigrationDialog', () => {
  it('marks Quit as the destructive action and Continue as the safe primary', () => {
    render(<CloseMigrationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Quit anyway' })).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByRole('button', { name: 'Continue migration' })).toHaveAttribute('data-variant', 'emphasis')
  })

  it('focuses Continue (not the destructive Quit) on open so an Enter/Space dismissal never quits', async () => {
    render(<CloseMigrationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue migration' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Quit anyway' })).not.toHaveFocus()
  })

  it('keeps migration running when the primary action is clicked', () => {
    const onOpenChange = vi.fn()
    render(<CloseMigrationDialog open onOpenChange={onOpenChange} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue migration' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('quits the app when the destructive action is clicked', () => {
    const onConfirm = vi.fn()
    render(<CloseMigrationDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Quit anyway' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
