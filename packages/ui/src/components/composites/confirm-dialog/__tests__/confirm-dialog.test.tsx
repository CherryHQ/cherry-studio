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

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses fade-scale motion without directional translation', () => {
    render(
      <ConfirmDialog
        open
        title="Confirm action"
        description="This action needs your confirmation."
        onOpenChange={() => {}}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Confirm action' })

    expect(dialog).toHaveClass(
      'data-[state=open]:fade-in-0',
      'data-[state=open]:zoom-in-99',
      'data-[state=closed]:fade-out-0',
      'data-[state=closed]:zoom-out-99'
    )
    expect(dialog).not.toHaveClass(
      'data-[state=open]:slide-in-from-bottom-4',
      'data-[state=closed]:slide-out-to-bottom-4'
    )
  })
})
