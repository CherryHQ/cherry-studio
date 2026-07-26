import i18n from '@renderer/i18n/resolver'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { formatErrorMessage } from '@renderer/utils/error'
import { act, cleanup, render, screen } from '@testing-library/react'
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
    DialogContent: ({ children, ...props }) => {
      delete props.showCloseButton
      delete props.overlayClassName
      delete props.closeOnOverlayClick
      delete props.onInteractOutside

      return React.createElement('div', { role: 'dialog', ...props }, children)
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

  it('toasts the failure, stays open, and resolves true on retry', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    const error = new Error('boom')
    const action = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    let result!: Promise<boolean>
    act(() => {
      result = ConfirmActionPopup.show({ title: 'Delete item', okText: 'Delete', action })
    })

    await screen.findByText('Delete item')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {})

    // Pre-regression feedback: title=common.error, description=formatErrorMessage(error).
    expect(toastError).toHaveBeenCalledWith({ title: i18n.t('common.error'), description: formatErrorMessage(error) })
    // Dialog stays open for a retry.
    expect(screen.getByText('Delete item')).toBeInTheDocument()

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
