import i18n from '@renderer/i18n/resolver'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
const dialogMock = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastError }
}))

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Button: ({ children, loadingIcon, loading, ...props }) =>
      React.createElement('button', props, loading ? loadingIcon : null, children),
    Dialog: ({ children, open, onOpenChange }) => {
      dialogMock.onOpenChange = onOpenChange
      return open ? React.createElement(React.Fragment, null, children) : null
    },
    DialogContent: ({ children, closeOnOverlayClick = true, onInteractOutside, ...props }) => {
      delete props.showCloseButton
      delete props.overlayClassName

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {
          type: 'button',
          'data-testid': 'dialog-overlay',
          onClick: () => {
            const event = {
              defaultPrevented: false,
              preventDefault: () => {
                event.defaultPrevented = true
              }
            }

            onInteractOutside?.(event)

            if (closeOnOverlayClick) {
              dialogMock.onOpenChange?.(false)
            }
          }
        }),
        React.createElement('div', { role: 'dialog', ...props }, children)
      )
    },
    DialogDescription: ({ children }) => React.createElement('div', null, children),
    DialogFooter: ({ children, ...props }) => React.createElement('div', props, children),
    DialogHeader: ({ children, ...props }) => React.createElement('div', props, children),
    DialogTitle: ({ children, ...props }) => React.createElement('h2', props, children)
  }
})

import { popup } from '@renderer/services/popup'

import { PopupHost } from '../index'

afterEach(async () => {
  // Unmount first so settling/removing leftover entries triggers no React update
  // on a still-mounted host (which would fire act warnings). Then drain the
  // singleton store so the next test starts empty.
  cleanup()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, false)
  }
  await new Promise((resolve) => setTimeout(resolve, POPUP_EXIT_MS + 20))
  toastError.mockClear()
  dialogMock.onOpenChange = undefined
})

describe('ConfirmPopupItem (via PopupHost + confirm presets)', () => {
  it('resolves confirm as true when the OK button is clicked', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let confirmed!: Promise<boolean>
    act(() => {
      confirmed = popup.confirm({
        title: 'Delete item',
        content: 'This cannot be undone.',
        okText: 'Delete',
        cancelText: 'Cancel'
      })
    })

    await screen.findByText('Delete item')
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {})

    await expect(confirmed).resolves.toBe(true)
  })

  it('resolves confirm as false when cancelled', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let confirmed!: Promise<boolean>
    act(() => {
      confirmed = popup.confirm({ title: 'Leave page', okText: 'Leave', cancelText: 'Stay' })
    })

    await user.click(await screen.findByRole('button', { name: 'Stay' }))
    await act(async () => {})

    await expect(confirmed).resolves.toBe(false)
  })

  it('renders feedback (error) popups without a cancel button', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let acknowledged!: Promise<boolean>
    act(() => {
      acknowledged = popup.error({ title: 'Backup failed', content: 'Disk is full.' })
    })

    await screen.findByText('Backup failed')
    expect(screen.queryByRole('button', { name: i18n.t('common.cancel') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await act(async () => {})
    await expect(acknowledged).resolves.toBe(true)
  })

  it('uses the translated destructive label for danger confirmations', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let confirmed!: Promise<boolean>
    act(() => {
      confirmed = popup.confirm({ title: 'Delete item', okButtonProps: { danger: true } })
    })

    await user.click(await screen.findByRole('button', { name: i18n.t('common.delete') }))
    await act(async () => {})
    await expect(confirmed).resolves.toBe(true)
  })

  it('keeps maskClosable=false popups open when the overlay is clicked', async () => {
    render(<PopupHost />)

    act(() => {
      void popup.confirm({ title: 'Migrating data', maskClosable: false, closable: false })
    })

    await screen.findByText('Migrating data')
    fireEvent.click(screen.getByTestId('dialog-overlay'))

    expect(screen.getByText('Migrating data')).toBeInTheDocument()
  })
})
