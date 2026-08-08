// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

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
})
