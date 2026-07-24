import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dialogMock = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Button: ({ children, variant, ...props }) =>
      React.createElement('button', { ...props, 'data-variant': variant }, children),
    Dialog: ({ children, open, onOpenChange }) => {
      dialogMock.onOpenChange = onOpenChange
      return open ? React.createElement(React.Fragment, null, children) : null
    },
    DialogContent: ({ children, ...props }) => {
      delete props.showCloseButton
      delete props.overlayClassName
      return React.createElement('div', { role: 'dialog', ...props }, children)
    },
    DialogDescription: ({ children, ...props }) => React.createElement('div', props, children),
    DialogFooter: ({ children, ...props }) => React.createElement('div', props, children),
    DialogHeader: ({ children, ...props }) => React.createElement('div', props, children),
    DialogTitle: ({ children, ...props }) => React.createElement('h2', props, children)
  }
})

import { PopupHost } from '@renderer/components/PopupHost'

import ModelDetectionLeavePopup from '../ModelDetectionLeavePopup'

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, 'stay')
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
  dialogMock.onOpenChange = undefined
})

describe('ModelDetectionLeavePopup', () => {
  it('makes continuing the detected-model flow the primary action', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let decision!: Promise<'leave' | 'stay'>
    act(() => {
      decision = ModelDetectionLeavePopup.show({ count: 2, phase: 'detected' })
    })

    expect(await screen.findByText('settings.models.auto_detect.leave_detected_title:2')).toBeInTheDocument()
    expect(screen.getByText('settings.models.auto_detect.leave_detected')).toBeInTheDocument()

    const leaveButton = screen.getByRole('button', { name: 'settings.models.auto_detect.leave_anyway' })
    const stayButton = screen.getByRole('button', { name: 'settings.models.auto_detect.stay_detected' })
    expect(leaveButton).toHaveAttribute('data-variant', 'outline')
    expect(stayButton).toHaveAttribute('data-variant', 'emphasis')

    await user.click(stayButton)
    await act(async () => {})

    await expect(decision).resolves.toBe('stay')
  })

  it('leaves only after the user explicitly chooses to leave', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let decision!: Promise<'leave' | 'stay'>
    act(() => {
      decision = ModelDetectionLeavePopup.show({ count: 0, phase: 'detecting' })
    })

    expect(await screen.findByText('settings.models.auto_detect.leave_detecting_title')).toBeInTheDocument()
    expect(screen.getByText('settings.models.auto_detect.leave_detecting')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.models.auto_detect.leave_anyway' }))
    await act(async () => {})

    await expect(decision).resolves.toBe('leave')
  })

  it('keeps the tab open when the dialog is dismissed', async () => {
    render(<PopupHost />)

    let decision!: Promise<'leave' | 'stay'>
    act(() => {
      decision = ModelDetectionLeavePopup.show({ count: 0, phase: 'detecting' })
    })

    await screen.findByText('settings.models.auto_detect.leave_detecting_title')
    act(() => {
      dialogMock.onOpenChange?.(false)
    })

    await expect(decision).resolves.toBe('stay')
  })
})
