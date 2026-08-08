// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '../index'

afterEach(cleanup)

describe('ConfirmDialog', () => {
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

  it('keeps the dialog open when confirmation rejects', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('failed'))
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Confirm action"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
        confirmText="Confirm"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Confirm action' })).toBeInTheDocument()
  })
})
