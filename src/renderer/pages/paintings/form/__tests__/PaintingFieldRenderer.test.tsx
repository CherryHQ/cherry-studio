import '@testing-library/jest-dom/vitest'

import { buildParamsSchema } from '@cherrystudio/provider-registry'
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

  it('displays a numeric string using the same effective value as submit normalization', () => {
    const support = {
      modes: {
        generate: {
          supports: { strength: { type: 'range' as const, min: 0, max: 10, default: 4 } }
        }
      }
    }
    const submitted = buildParamsSchema(support, 'generate').parse({ strength: '4.5' })

    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'strength', min: 0, max: 10, initialValue: 4 }}
        painting={{ strength: '4.5' }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('spinbutton')).toHaveValue(4.5)
    expect(submitted.strength).toBe(4.5)
  })

  it.each([true, false, [], ['4.5']])('drops invalid numeric input %# in both display and submit paths', (value) => {
    const support = {
      modes: {
        generate: {
          supports: { strength: { type: 'range' as const, min: 0, max: 10, default: 4 } }
        }
      }
    }
    const submitted = buildParamsSchema(support, 'generate').parse({ strength: value })

    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'strength', min: 0, max: 10, initialValue: 4 }}
        painting={{ strength: value }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('spinbutton')).toHaveValue(4)
    expect(submitted.strength).toBeUndefined()
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

  it('falls back to the typed option default for a wrong-typed persisted value', () => {
    render(
      <PaintingFieldRenderer
        item={{
          type: 'select',
          key: 'size',
          initialValue: '1024x1024',
          options: [{ value: '1024x1024', label: '1024' }]
        }}
        painting={{ size: true }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByTestId('select')).toHaveAttribute('data-value', '1024x1024')
  })

  it('rejects a decimal persisted value for an integer-backed slider', () => {
    const support = {
      modes: {
        generate: {
          supports: { numImages: { type: 'range' as const, min: 1, max: 10, default: 1 } }
        }
      }
    }
    const submitted = buildParamsSchema(support, 'generate').parse({ numImages: '2.5' })

    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'numImages', min: 1, max: 10, initialValue: 1 }}
        painting={{ numImages: '2.5' }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('spinbutton')).toHaveValue(1)
    expect(submitted.numImages).toBeUndefined()
  })
})
