import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isDisabled?: boolean
  onPress?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
  variant?: string
}
type MockChildrenProps = { children?: ReactNode }
type MockDialogProps = MockChildrenProps & { open?: boolean }

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

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    // Mirror the real Button's public contract: it emits the intent as `data-variant`
    // (not a raw `variant` attribute) and forwards `autoFocus` to the native element.
    Button: ({ children, disabled, isDisabled, onPress, variant, ...props }: MockButtonProps) =>
      React.createElement(
        'button',
        { ...props, 'data-variant': variant, disabled: disabled || isDisabled, onClick: onPress ?? props.onClick },
        children
      ),
    Dialog: ({ children, open }: MockDialogProps) =>
      open ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null,
    DialogContent: ({ children }: MockChildrenProps) =>
      React.createElement('div', { 'data-testid': 'dialog-content' }, children),
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
  it('marks quitting as the destructive action', () => {
    render(<CloseMigrationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Quit anyway' })).toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByRole('button', { name: 'Continue migration' })).toHaveAttribute('data-variant', 'emphasis')
  })

  it('focuses Continue as the safe default so an Enter/Space dismissal never quits', () => {
    render(<CloseMigrationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Continue migration' })).toHaveFocus()
  })

  it('keeps migration running when the primary action is clicked', () => {
    const onOpenChange = vi.fn()
    render(<CloseMigrationDialog open onOpenChange={onOpenChange} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue migration' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
