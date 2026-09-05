// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { PopupHost } from '@renderer/components/PopupHost'
import i18n from '@renderer/i18n/resolver'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { formatErrorMessage } from '@renderer/utils/error'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
      name: 'Also move related sessions to the Recycle Bin'
    })
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

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
        name: 'Also move related sessions to the Recycle Bin'
      })
    )
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

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
        name: 'Also move related topics to the Recycle Bin'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', {
        name: 'Also move related sessions to the Recycle Bin'
      })
    ).not.toBeInTheDocument()
  })

  it('resets the cascade choice after closing and reopening', async () => {
    const user = userEvent.setup()
    render(<ControlledHarness />)

    const checkbox = screen.getByRole('checkbox', {
      name: 'Also move related sessions to the Recycle Bin'
    })
    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Open deletion dialog' }))

    expect(
      screen.getByRole('checkbox', {
        name: 'Also move related sessions to the Recycle Bin'
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
        name: 'Also move related sessions to the Recycle Bin'
      })
    )

    rerender(<DeleteConversationOwnerConfirmDialog key="agent-2" {...props} />)

    expect(
      screen.getByRole('checkbox', {
        name: 'Also move related sessions to the Recycle Bin'
      })
    ).not.toBeChecked()
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
      name: 'Also move related sessions to the Recycle Bin'
    })
    expect(checkbox).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move to Recycle Bin' })).toBeDisabled()
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
  it('resolves false without running the action when cancelled', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<PopupHost />)

    let result!: Promise<boolean>
    act(() => {
      result = deleteConversationOwnerPopup.show({ type: 'agent', action })
    })

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(action).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(false)
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

    await user.click(await screen.findByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith({
        title: i18n.t('common.error'),
        description: formatErrorMessage(error)
      })
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(ignoredAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    expect(action).toHaveBeenCalledTimes(2)
    await expect(result).resolves.toBe(true)
  })
})
