// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
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
