// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { PopupHost } from '@renderer/components/PopupHost'
import i18n from '@renderer/i18n/resolver'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { formatErrorMessage } from '@renderer/utils/error'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastError }
}))

import {
  DeleteConversationOwnerConfirmDialog,
  deleteConversationOwnerPopup
} from '../DeleteConversationOwnerConfirmDialog'

const preferenceKey = 'assistant.archive.related_topics'
const defaultPreferenceImplementation = mockUsePreference.getMockImplementation()!

interface HarnessProps {
  targetId?: string
}

function ControlledHarness({ targetId = 'agent-1' }: HarnessProps) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open deletion dialog
      </button>
      <DeleteConversationOwnerConfirmDialog
        key={targetId}
        type="agent"
        open={open}
        pending={false}
        onOpenChange={setOpen}
        onConfirm={() => {}}
      />
    </>
  )
}

beforeEach(async () => {
  mockUsePreference.mockImplementation(defaultPreferenceImplementation)
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue(preferenceKey, false)
  await i18n.changeLanguage('en-US')
})

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, false)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
  toastError.mockClear()
})

describe('DeleteConversationOwnerConfirmDialog', () => {
  it('defaults to deleting only the agent and submits the unchecked choice', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <DeleteConversationOwnerConfirmDialog
        type="agent"
        open
        pending={false}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Also archive related sessions'
    })
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('submits the checked choice for related sessions', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <DeleteConversationOwnerConfirmDialog
        type="agent"
        open
        pending={false}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />
    )

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Also archive related sessions'
      })
    )
    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('labels the cascade choice as related topics for assistants', () => {
    render(
      <DeleteConversationOwnerConfirmDialog
        type="assistant"
        open
        pending={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />
    )

    expect(
      screen.getByRole('checkbox', {
        name: 'Also archive related topics'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', {
        name: 'Also archive related sessions'
      })
    ).not.toBeInTheDocument()
  })

  it('resets the cascade choice after closing and reopening', async () => {
    const user = userEvent.setup()
    render(<ControlledHarness />)

    const checkbox = screen.getByRole('checkbox', {
      name: 'Also archive related sessions'
    })
    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Open deletion dialog' }))

    expect(
      screen.getByRole('checkbox', {
        name: 'Also archive related sessions'
      })
    ).not.toBeChecked()
  })

  it('resets the cascade choice when the deletion target is remounted', async () => {
    const user = userEvent.setup()
    const props = {
      type: 'agent' as const,
      open: true,
      pending: false,
      onOpenChange: () => {},
      onConfirm: () => {}
    }
    const { rerender } = render(<DeleteConversationOwnerConfirmDialog key="agent-1" {...props} />)

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Also archive related sessions'
      })
    )

    rerender(<DeleteConversationOwnerConfirmDialog key="agent-2" {...props} />)

    expect(
      screen.getByRole('checkbox', {
        name: 'Also archive related sessions'
      })
    ).not.toBeChecked()
  })

  it('remembers assistant choices in both directions and saves changes even when canceled', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const props = {
      type: 'assistant' as const,
      open: true,
      pending: false,
      onOpenChange: vi.fn(),
      onConfirm
    }
    const first = render(<DeleteConversationOwnerConfirmDialog key="assistant-1" {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()

    await user.click(screen.getByRole('checkbox'))
    first.rerender(<DeleteConversationOwnerConfirmDialog key="assistant-1" {...props} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
    first.unmount()

    const second = render(<DeleteConversationOwnerConfirmDialog key="assistant-2" {...props} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.click(screen.getByRole('checkbox'))
    second.rerender(<DeleteConversationOwnerConfirmDialog key="assistant-2" {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(onConfirm).toHaveBeenNthCalledWith(2, false)
    second.unmount()

    onConfirm.mockClear()
    const third = render(<DeleteConversationOwnerConfirmDialog key="assistant-3" {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.click(screen.getByRole('checkbox'))
    third.rerender(<DeleteConversationOwnerConfirmDialog key="assistant-3" {...props} />)
    expect(mockPreferenceState.get(preferenceKey)).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    third.unmount()

    const fourth = render(<DeleteConversationOwnerConfirmDialog key="assistant-4" {...props} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.click(screen.getByRole('checkbox'))
    fourth.rerender(<DeleteConversationOwnerConfirmDialog key="assistant-4" {...props} />)
    expect(mockPreferenceState.get(preferenceKey)).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    fourth.unmount()

    render(<DeleteConversationOwnerConfirmDialog key="assistant-5" {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('follows changed hook values in an already-open assistant dialog', async () => {
    const user = userEvent.setup()
    const setter = vi.fn().mockResolvedValue(undefined)
    const props = {
      type: 'assistant' as const,
      open: true,
      pending: false,
      onOpenChange: vi.fn(),
      onConfirm: vi.fn()
    }
    MockUsePreferenceUtils.mockPreferenceReturn(preferenceKey, false, setter)
    const { rerender } = render(<DeleteConversationOwnerConfirmDialog {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()

    MockUsePreferenceUtils.mockPreferenceReturn(preferenceKey, true, setter)
    rerender(<DeleteConversationOwnerConfirmDialog {...props} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith(true)

    MockUsePreferenceUtils.mockPreferenceReturn(preferenceKey, false, setter)
    rerender(<DeleteConversationOwnerConfirmDialog {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(props.onConfirm).toHaveBeenNthCalledWith(2, false)
  })

  it('keeps agent choices transient while the remembered assistant choice is true', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue(preferenceKey, true)
    const onConfirm = vi.fn()
    const props = {
      type: 'agent' as const,
      open: true,
      pending: false,
      onOpenChange: vi.fn(),
      onConfirm
    }
    const dialog = render(<DeleteConversationOwnerConfirmDialog {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
    dialog.rerender(<DeleteConversationOwnerConfirmDialog {...props} open={false} />)
    dialog.rerender(<DeleteConversationOwnerConfirmDialog {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.click(screen.getByRole('checkbox'))
    dialog.unmount()

    const remounted = render(<DeleteConversationOwnerConfirmDialog {...props} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(mockPreferenceState.get(preferenceKey)).toBe(true)
    remounted.unmount()
    render(<DeleteConversationOwnerConfirmDialog {...props} type="assistant" />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('consumes a rejected preference write and keeps the assistant dialog usable', async () => {
    const user = userEvent.setup()
    const error = new Error('write failed')
    MockUsePreferenceUtils.mockPreferenceError(preferenceKey, error)
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DeleteConversationOwnerConfirmDialog
        type="assistant"
        open
        pending={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    )

    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith({
        title: i18n.t('common.error'),
        description: formatErrorMessage(error)
      })
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('blocks every dismissal path while deletion is pending', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <DeleteConversationOwnerConfirmDialog
        type="agent"
        open
        pending
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Also archive related sessions'
    })
    expect(checkbox).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled()
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeDisabled()

    await user.click(cancelButton)
    await user.keyboard('{Escape}')

    // The Radix overlay has no semantic role; data-slot is the maintained primitive contract.
    const overlay = document.body.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    fireEvent.click(overlay!)

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('deleteConversationOwnerPopup', () => {
  it.each(['agent', 'assistant'] as const)('requires explicit confirmation for archiving an %s', async (type) => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<PopupHost />)
    let result!: Promise<boolean>
    act(() => {
      result = deleteConversationOwnerPopup.show({ type, action })
    })
    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveAccessibleName(/Also archive related/)
    expect(screen.queryByRole('button', { name: 'Delete Permanently' })).not.toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBe(false)
    expect(action).not.toHaveBeenCalled()
  })

  it('submits the archive cascade only after it is explicitly checked and confirmed', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<PopupHost />)
    let result!: Promise<boolean>
    act(() => {
      result = deleteConversationOwnerPopup.show({ type: 'agent', action })
    })
    await user.click(await screen.findByRole('checkbox'))
    expect(action).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    await expect(result).resolves.toBe(true)
    expect(action).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('shows an error, stays open, and resolves true after retrying the same single-flight popup', async () => {
    const user = userEvent.setup()
    const error = new Error('delete failed')
    const action = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
    const ignoredAction = vi.fn()
    render(<PopupHost />)

    let result!: Promise<boolean>
    let duplicate!: Promise<boolean>
    act(() => {
      result = deleteConversationOwnerPopup.show({ type: 'assistant', action })
      duplicate = deleteConversationOwnerPopup.show({ type: 'agent', action: ignoredAction })
    })
    expect(duplicate).toBe(result)

    await user.click(await screen.findByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith({
        title: i18n.t('common.error'),
        description: formatErrorMessage(error)
      })
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(ignoredAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(action).toHaveBeenCalledTimes(2)
    await expect(result).resolves.toBe(true)
  })
})
