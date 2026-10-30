import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { createPopup, POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
const dialogMock = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastError }
}))

const { openAppErrorDetail } = vi.hoisted(() => ({ openAppErrorDetail: vi.fn(async () => 'opened' as const) }))

vi.mock('@renderer/services/AppErrorDetailService', () => ({
  appErrorDetailService: { openAppErrorDetail }
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
    DialogContent: ({
      children,
      closeOnOverlayClick = true,
      motion,
      onInteractOutside,
      overlayClassName,
      ...props
    }) => {
      delete props.showCloseButton

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {
          type: 'button',
          'data-testid': 'dialog-overlay',
          className: overlayClassName,
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
        React.createElement('div', { role: 'dialog', 'data-motion': motion, ...props }, children)
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

afterEach(() => {
  // Unmount first so settling/removing leftover entries triggers no React update
  // on a still-mounted host (which would fire act warnings). Then drain the
  // singleton store so the next test starts empty. Fake timers fire the exit phase
  // synchronously (no wall-clock wait).
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, false)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
  toastError.mockClear()
  dialogMock.onOpenChange = undefined
})

describe('PopupHost', () => {
  it('injects open state and a resolving callback into component popups', async () => {
    const user = userEvent.setup()
    const ComponentPopup = createPopup<{ label: string }, string>(
      ({ label, open, resolve }) => (
        <div>
          <span>{label}</span>
          <span>{open ? 'Component open' : 'Component closing'}</span>
          <button type="button" onClick={() => resolve('accepted')}>
            Resolve component
          </button>
        </div>
      ),
      { dismissResult: 'dismissed' }
    )
    render(<PopupHost />)

    let pending!: Promise<string>
    act(() => {
      pending = ComponentPopup.show({ label: 'Custom content' })
    })

    expect(screen.getByText('Custom content')).toBeInTheDocument()
    expect(screen.getByText('Component open')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resolve component' }))
    await act(async () => {})

    await expect(pending).resolves.toBe('accepted')
    expect(screen.getByText('Component closing')).toBeInTheDocument()
  })
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
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'fade-scale')

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
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'fade-scale')
    expect(screen.queryByRole('button', { name: i18n.t('common.cancel') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await act(async () => {})
    await expect(acknowledged).resolves.toBe(true)
  })

  it('does not settle an error popup when details is opened', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    const failure = new Error('disk full')

    let acknowledged!: Promise<boolean>
    let settled = false
    act(() => {
      acknowledged = popup.error({ cause: failure, content: 'Disk is full.', title: 'Backup failed' })
      void acknowledged.then(() => {
        settled = true
      })
    })

    await user.click(await screen.findByRole('button', { name: i18n.t('error.details') }))
    expect(openAppErrorDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'disk full', name: 'Error' }),
        localizedErrorMessage: 'Backup failed'
      })
    )
    expect(settled).toBe(false)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await act(async () => {})
    await expect(acknowledged).resolves.toBe(true)
  })

  it('keeps a string explanation when the error popup has no cause', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void popup.error({ content: 'Disk is full.', title: 'Backup failed' })
    })

    await user.click(await screen.findByRole('button', { name: i18n.t('error.details') }))
    expect(openAppErrorDetail).toHaveBeenCalledWith(expect.objectContaining({ localizedErrorMessage: 'Backup failed' }))
    expect(screen.getByRole('button', { name: i18n.t('common.confirm') })).toBeInTheDocument()
  })

  it('does not stringify a React title or content', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    act(() => {
      void popup.error({
        cause: new Error('disk full'),
        content: <span>not text</span>,
        title: <span>not a title</span>
      })
    })

    await user.click(await screen.findByRole('button', { name: i18n.t('error.details') }))
    expect(openAppErrorDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'disk full' }),
        localizedErrorMessage: i18n.t('error.unexpected')
      })
    )
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
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

  it('keeps the original confirmation pending while a later detail popup is open', async () => {
    // z-[90] on the confirm overlay is the stacking contract that hid the default z-80 detail dialog.
    render(<PopupHost />)
    const DetailPopup = createPopup<{ label: string }, void>(
      ({ label, open, resolve }) =>
        open ? (
          <div aria-label={label} role="dialog">
            <button type="button" onClick={() => resolve()}>
              Close details
            </button>
          </div>
        ) : null,
      { dismissResult: undefined }
    )

    let acknowledged!: Promise<boolean>
    let settled = false
    act(() => {
      acknowledged = popup.error({ cause: new Error('disk full'), content: 'Disk is full.', title: 'Backup failed' })
      void acknowledged.then(() => {
        settled = true
      })
    })

    const confirmDialog = await screen.findByRole('dialog')
    expect(confirmDialog).toHaveAttribute('data-confirm-popup', 'true')
    expect(confirmDialog.className).not.toContain('z-[90]')
    expect(screen.getByTestId('dialog-overlay').className).not.toContain('z-[90]')

    let detail!: Promise<void>
    act(() => {
      detail = DetailPopup.show({ label: 'Error details' })
    })

    const detailDialog = screen.getByRole('dialog', { name: 'Error details' })
    expect(confirmDialog.compareDocumentPosition(detailDialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(settled).toBe(false)
    expect(screen.getByRole('button', { name: i18n.t('common.confirm') })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    await act(async () => {})
    await expect(detail).resolves.toBeUndefined()
    expect(settled).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Error details' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))
    await act(async () => {})
    await expect(acknowledged).resolves.toBe(true)
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
