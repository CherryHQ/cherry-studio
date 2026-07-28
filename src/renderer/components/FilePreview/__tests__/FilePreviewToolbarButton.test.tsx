import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilePreviewToolbarButton } from '../FilePreviewToolbarButton'

vi.unmock('@cherrystudio/ui')

afterEach(cleanup)

describe('FilePreviewToolbarButton', () => {
  it('keeps the pressed foreground stronger than the idle toolbar color', () => {
    render(
      <FilePreviewToolbarButton label="Toggle source" disabled={false} pressed onClick={vi.fn()}>
        Source
      </FilePreviewToolbarButton>
    )

    const button = screen.getByRole('button', { name: 'Toggle source', pressed: true })
    expect(button).toHaveClass('text-foreground')
    expect(button).not.toHaveClass('text-muted-foreground')
  })
})
