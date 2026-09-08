import '@testing-library/jest-dom/vitest'

import { buildParamsSchema } from '@cherrystudio/provider-registry'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { SliderConfigItem } from '../baseConfigItem'
import { PaintingFieldRenderer } from '../PaintingFieldRenderer'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

function renderSlider(item: Partial<SliderConfigItem>, painting: Record<string, unknown>) {
  const onChange = vi.fn()
  render(
    <PaintingFieldRenderer
      item={{ type: 'slider', key: 'guidanceScale', ...item } as SliderConfigItem}
      painting={painting}
      onChange={onChange}
    />
  )
  return onChange
}

describe('PaintingFieldRenderer slider input', () => {
  // `role="spinbutton"` announces a value and a range; with no name it is a number
  // with no subject, and nothing else in the suite would notice the name going.
  it('names the slider companion field', () => {
    renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    expect(screen.getByRole('spinbutton')).toHaveAccessibleName()
  })

  it('accepts a fractional value when the field step is fractional', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '7.5')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 7.5 })
  })

  it('clamps a value above the maximum on blur', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '99')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 20 })
  })

  it('writes nothing while typing, so the slider never sees a half-typed value', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '99')

    expect(input).toHaveValue('99')
    expect(onChange).not.toHaveBeenCalled()
  })

  // Clearing to retype settles as `null`, which is not a value the slider can
  // hold: writing it would drop the field to `min`.
  it('writes nothing when the field is cleared and left empty', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 1, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('PaintingFieldRenderer dynamic value boundary', () => {
  it('falls back to the typed slider default for a non-numeric param', () => {
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'strength', min: 0, max: 10, initialValue: 4 }}
        painting={{ strength: 'not-a-number' }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('spinbutton')).toHaveValue('4')
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

    expect(screen.getByRole('spinbutton')).toHaveValue('4.5')
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

    expect(screen.getByRole('spinbutton')).toHaveValue('4')
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

    expect(screen.getByRole('spinbutton')).toHaveValue('1')
    expect(submitted.numImages).toBeUndefined()
  })
})
