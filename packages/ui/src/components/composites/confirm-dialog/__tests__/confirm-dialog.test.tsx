// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '../index'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('guards a disabled confirmation without blocking cancellation', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ConfirmDialog
        open
        confirmDisabled
        title="Confirm action"
        confirmText="Confirm"
        cancelText="Cancel"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    )

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    expect(confirmButton).toBeDisabled()

    await user.click(confirmButton)

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeEnabled()

    await user.click(cancelButton)

    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables cancellation when requested', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<ConfirmDialog open cancelDisabled title="Confirm action" cancelText="Cancel" onOpenChange={onOpenChange} />)

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeDisabled()

    await user.click(cancelButton)

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('stays open when confirmation resolves false', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue(false)
    render(<ConfirmDialog open title="Confirm action" onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it.each([
    ['void', () => undefined],
    ['true', () => true]
  ])('closes when confirmation returns %s', async (_label, onConfirm) => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog open title="Confirm action" onOpenChange={onOpenChange} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
