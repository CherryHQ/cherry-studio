import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'
import { createPopup, POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const { toastError, openErrorDetail } = vi.hoisted(() => ({
  toastError: vi.fn(),
  openErrorDetail: vi.fn().mockResolvedValue('opened')
}))
const dialogMock = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastError }
}))

vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  appErrorDetailService: { openAppErrorDetail: openErrorDetail }
}))

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Alert: ({ children, role }) => React.createElement('div', { role: role ?? 'alert' }, children),
    Button: ({ children, loadingIcon, loading, ...props }) =>
      React.createElement('button', props, loading ? loadingIcon : null, children),
    Dialog: ({ children, open, onOpenChange }) => {
      dialogMock.onOpenChange = onOpenChange
      return open ? React.createElement(React.Fragment, null, children) : null
    },
    DialogContent: ({ children, overlayClassName, ...props }) => {
      delete props.showCloseButton
      delete props.closeOnOverlayClick
      delete props.onInteractOutside

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {
          type: 'button',
          'data-testid': 'dialog-overlay',
          className: overlayClassName
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

vi.mock('@cherrystudio/ui/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

import { PopupHost } from '@renderer/components/PopupHost'

import ConfirmActionPopup from '../ConfirmActionPopup'

afterEach(() => {
  // Unmount first so draining leftover entries fires no React update on a still-mounted
  // host, then settle+drain the singleton store for the next test with fake timers.
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, false)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
  toastError.mockClear()
  openErrorDetail.mockClear()
  dialogMock.onOpenChange = undefined
})

describe('ConfirmActionPopup', () => {
  it('runs the action and resolves true on success', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    const action = vi.fn().mockResolvedValue(undefined)
    let result!: Promise<boolean>
    act(() => {
      result = ConfirmActionPopup.show({
        title: 'Delete item',
        okText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
        action
      })
    })

    await screen.findByText('Delete item')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {})

    expect(action).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(true)
  })

  // The dialog traps focus, so a Details entry that only lives in the window-level toast is unreachable by keyboard.
  it('shows the failure inside the dialog with keyboard-reachable Details, stays open, and resolves true on retry', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    const error = new Error('boom')
    const action = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    let result!: Promise<boolean>
    let settled = false
    act(() => {
      result = ConfirmActionPopup.show({ title: 'Delete item', okText: 'Delete', action })
      void result.then(() => {
        settled = true
      })
    })

    await screen.findByText('Delete item')
    const confirmDialog = screen.getByRole('dialog')
    expect(confirmDialog.className).not.toContain('z-[90]')
    expect(screen.getByTestId('dialog-overlay').className).not.toContain('z-[90]')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {})

    const alert = within(confirmDialog).getByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('common.error'))
    expect(alert).toHaveTextContent('boom')
    const details = within(alert).getByRole('button', { name: i18n.t('common.detail') })
    for (let step = 0; step < 10 && document.activeElement !== details; step++) await user.tab()
    expect(details).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(openErrorDetail).toHaveBeenCalledTimes(1))
    expect(openErrorDetail.mock.calls[0][0].context).toMatchObject({
      message: 'boom',
      operation: 'confirm_action.run',
      source: 'popup.confirm_action'
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(settled).toBe(false)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()

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
    act(() => {
      void DetailPopup.show({ label: 'Error details' })
    })
    const detailDialog = screen.getByRole('dialog', { name: 'Error details' })
    expect(confirmDialog.compareDocumentPosition(detailDialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(settled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {})

    expect(action).toHaveBeenCalledTimes(2)
    await expect(result).resolves.toBe(true)
  })

  it('resolves false and never runs the action when cancelled', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    const action = vi.fn()
    let result!: Promise<boolean>
    act(() => {
      result = ConfirmActionPopup.show({ title: 'Delete item', cancelText: 'Cancel', action })
    })

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await act(async () => {})

    expect(action).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(false)
  })
})
