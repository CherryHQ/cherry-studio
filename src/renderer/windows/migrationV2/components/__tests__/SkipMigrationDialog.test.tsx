import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockChildrenProps = { children?: ReactNode }
type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  const DialogContext = React.createContext({ onOpenChange: Function.prototype as (open: boolean) => void })

  return {
    Alert: ({ children }: MockChildrenProps) => React.createElement('div', null, children),
    Button: ({ children, disabled, loading, ...props }: MockButtonProps) =>
      React.createElement(
        'button',
        { ...props, 'aria-busy': loading || undefined, disabled: disabled || loading },
        children
      ),
    Dialog: ({
      children,
      onOpenChange,
      open
    }: MockChildrenProps & { onOpenChange?: (open: boolean) => void; open?: boolean }) =>
      open ? React.createElement(DialogContext.Provider, { value: { onOpenChange } }, children) : null,
    DialogClose: ({ children }: MockChildrenProps) => {
      const { onOpenChange } = React.use(DialogContext)
      const child = children as ReactElement<Record<string, unknown>>
      return React.createElement(child.type, { ...child.props, onClick: () => onOpenChange?.(false) })
    },
    DialogContent: (allProps: MockChildrenProps & Record<string, unknown>) => {
      const { children } = allProps
      const props = { ...allProps }
      delete props.children
      delete props.closeOnOverlayClick
      delete props.showCloseButton
      const { onOpenChange } = React.use(DialogContext)
      return React.createElement(
        'div',
        { ...props, role: 'dialog' },
        children,
        React.createElement(
          'button',
          { type: 'button', 'data-testid': 'escape-dismiss', onClick: () => onOpenChange?.(false) },
          'escape'
        ),
        React.createElement(
          'button',
          { type: 'button', 'data-testid': 'overlay-dismiss', onClick: () => onOpenChange?.(false) },
          'overlay'
        )
      )
    },
    DialogDescription: ({ children }: MockChildrenProps) => children,
    DialogFooter: ({ children }: MockChildrenProps) => React.createElement('div', null, children),
    DialogHeader: ({ children }: MockChildrenProps) => React.createElement('div', null, children),
    DialogTitle: ({ children }: MockChildrenProps) => React.createElement('h2', null, children)
  }
})

import { SkipMigrationDialog } from '../SkipMigrationDialog'

describe('SkipMigrationDialog', () => {
  afterEach(() => vi.useRealTimers())

  it('blocks every dismissal path while the skip request is pending', async () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<SkipMigrationDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    fireEvent.click(screen.getByRole('button', { name: 'migration.skip_dialog.confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'migration.skip_dialog.confirm' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'migration.skip_dialog.cancel' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'migration.skip_dialog.cancel' }))
    fireEvent.click(screen.getByTestId('escape-dismiss'))
    fireEvent.click(screen.getByTestId('overlay-dismiss'))

    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
