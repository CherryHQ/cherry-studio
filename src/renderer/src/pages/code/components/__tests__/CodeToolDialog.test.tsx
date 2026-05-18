import '@testing-library/jest-dom/vitest'

import { codeCLI } from '@shared/config/constant'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodeToolDialog } from '../CodeToolDialog'
import type { CodeToolMeta } from '../types'

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Button: ({ children, loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          ...props,
          disabled: props.disabled || loading
        },
        children
      ),
    Dialog: ({
      open,
      children,
      onOpenChange
    }: {
      open: boolean
      children: React.ReactNode
      onOpenChange?: (open: boolean) => void
    }) =>
      open
        ? React.createElement('div', { 'data-dialog-root': true, onClick: () => onOpenChange?.(false) }, children)
        : null,
    DialogClose: ({ children }: { children: React.ReactNode }) => children,
    DialogContent: ({
      children,
      className,
      overlayClassName,
      showCloseButton = true
    }: {
      children: React.ReactNode
      className?: string
      overlayClassName?: string
      showCloseButton?: boolean
    }) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement('div', { 'data-slot': 'dialog-overlay', className: overlayClassName }),
        React.createElement(
          'div',
          {
            role: 'dialog',
            className: `border border-border ${className ?? ''}`,
            'data-default-close': showCloseButton ? 'visible' : 'hidden'
          },
          children
        )
      ),
    DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement('div', { className }, children),
    DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement('div', { className }, children),
    DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement('h2', { className }, children)
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const tool = {
  id: codeCLI.openaiCodex,
  label: 'OpenAI Codex',
  icon: () => <span data-testid="tool-icon" />
} satisfies CodeToolMeta

function renderDialog(props: Partial<React.ComponentProps<typeof CodeToolDialog>> = {}) {
  const defaultProps = {
    open: true,
    tool,
    canLaunch: true,
    status: 'idle' as const,
    onClose: vi.fn(),
    onLaunch: vi.fn()
  } satisfies React.ComponentProps<typeof CodeToolDialog>

  return render(
    <CodeToolDialog {...defaultProps} {...props}>
      <div>Dialog body</div>
    </CodeToolDialog>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CodeToolDialog', () => {
  it('renders the title, body, and launch actions', () => {
    renderDialog()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument()
    expect(screen.getByText('Dialog body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.close' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /code.launch.label/ })).toBeEnabled()
  })

  it('uses the shared plain dialog shell', () => {
    renderDialog()

    expect(screen.getByRole('dialog')).toHaveAttribute('data-default-close', 'hidden')
  })

  it('disables launch when the tool cannot launch', () => {
    renderDialog({ canLaunch: false })

    expect(screen.getByRole('button', { name: /code.launch.label/ })).toBeDisabled()
  })

  it('shows the launching state without calling launch again', () => {
    const onLaunch = vi.fn()
    renderDialog({ status: 'launching', onLaunch })

    const launchButton = screen.getByRole('button', { name: /code.launching/ })
    expect(launchButton).toBeDisabled()

    fireEvent.click(launchButton)
    expect(onLaunch).not.toHaveBeenCalled()
  })

  it('shows the launched state after launch succeeds', () => {
    renderDialog({ status: 'success' })

    expect(screen.getByRole('button', { name: /code.launch.launched/ })).toBeEnabled()
  })

  it('invokes onLaunch exactly once when the launch button is clicked while enabled', () => {
    const onLaunch = vi.fn()
    renderDialog({ onLaunch })

    fireEvent.click(screen.getByRole('button', { name: /code.launch.label/ }))
    expect(onLaunch).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when the dialog dismisses', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })

    // The mocked Dialog calls onOpenChange(false) on click of its container
    fireEvent.click(screen.getByText('Dialog body').closest('[data-dialog-root]') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
