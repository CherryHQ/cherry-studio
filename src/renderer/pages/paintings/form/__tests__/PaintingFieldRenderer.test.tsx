import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PaintingFieldRenderer } from '../PaintingFieldRenderer'

describe('PaintingFieldRenderer dynamic value boundary', () => {
  it('falls back to the typed slider default for a non-numeric param', () => {
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'strength', min: 0, max: 10, initialValue: 4 }}
        painting={{ strength: 'not-a-number' }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('spinbutton')).toHaveValue(4)
  })

  it('does not stringify an invalid text param into the input', () => {
    render(
      <PaintingFieldRenderer
        item={{ type: 'input', key: 'seed', initialValue: 'fallback' }}
        painting={{ seed: { nested: true } }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('fallback')
  })
})
