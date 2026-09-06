import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SizeChipsField from '../fields/SizeChipsField'

const renderChips = (overrides: { currentValue?: string; disabled?: boolean } = {}) =>
  render(
    <SizeChipsField
      item={{
        type: 'sizeChips',
        key: 'imageResolution',
        options: [
          { label: '1K', value: '1K' },
          { label: '2K', value: '2K' },
          { label: '4K', value: '4K' }
        ]
      }}
      fieldKey="imageResolution"
      painting={{}}
      translate={(key) => key}
      onChange={vi.fn()}
      currentValue={overrides.currentValue ?? '4K'}
      disabled={overrides.disabled ?? false}
    />
  )

describe('SizeChipsField', () => {
  it('keeps the selected outline inside the chip bounds', () => {
    renderChips()

    const selected = screen.getByRole('button', { name: '4K' })
    // Selected uses the theme primary border/tint; an outer ring would clip at the scrollport.
    expect(selected).toHaveClass('border-primary', 'bg-primary/10')
    expect(selected).not.toHaveClass('ring-1')
  })

  it('does not fill idle chips with a muted surface', () => {
    renderChips()

    const idle = screen.getByRole('button', { name: '1K' })
    expect(idle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute('aria-pressed', 'true')
    // bg-muted created the gray slab hierarchy in the narrow params popover.
    expect(idle).not.toHaveClass('bg-muted')
    expect(idle).toHaveClass('bg-transparent')
  })

  it('disables every chip when the field is disabled', () => {
    renderChips({ disabled: true })

    expect(screen.getByRole('button', { name: '1K' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '4K' })).toBeDisabled()
  })
})
