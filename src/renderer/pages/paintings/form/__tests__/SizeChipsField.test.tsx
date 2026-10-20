import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SizeChipsField from '../fields/SizeChipsField'

describe('SizeChipsField', () => {
  it('keeps the selected outline inside the chip bounds', () => {
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
        currentValue="4K"
        disabled={false}
      />
    )

    // The chip can sit flush with a scrollport edge, so an outer ring would be clipped.
    expect(screen.getByRole('button', { name: '4K' })).toHaveClass('ring-1', 'ring-inset')
  })
})
