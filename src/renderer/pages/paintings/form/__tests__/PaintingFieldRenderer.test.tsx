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
  it('names the slider companion field', () => {
    renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    expect(screen.getByRole('spinbutton')).toHaveAccessibleName()
  })

  it('keeps the numeric control compact', () => {
    renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 16.5 })

    expect(screen.getByRole('spinbutton')).toHaveClass('h-8', 'w-12')
  })

  it('aligns a typed value to an explicit integer step on settle', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ key: 'numImages', min: 1, max: 4, step: 1, initialValue: 1 }, { numImages: 1 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '2.5')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ numImages: 3 })
  })

  it('keeps a typed value that is already on a decimal step', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 1, max: 20, step: 0.1 }, { guidanceScale: 5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '4.5')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 4.5 })
  })

  it('keeps decimal precision when step is omitted', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ key: 'imageWeight', min: 1, max: 100, initialValue: 50 }, { imageWeight: 50 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '50.5')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ imageWeight: 50.5 })
  })

  it('clamps a value above the maximum on settle', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '99')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 20 })
  })

  it('does not write a half-typed value into the slider state', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '99')

    expect(input).toHaveValue('99')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('writes nothing when the field is cleared and left empty', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 1, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps persisted out-of-range values inside both control bounds', () => {
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 99 })

    expect(screen.getByRole('slider')).toHaveValue('20')
    expect(screen.getByRole('spinbutton')).toHaveValue('20')
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-valuenow', '20')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('PaintingFieldRenderer seed reset control', () => {
  it('pairs the seed field with a same-height labeled reset button', async () => {
    const onGenerateRandomSeed = vi.fn()
    render(
      <PaintingFieldRenderer
        item={{ type: 'input', key: 'seed', title: 'paintings.seed' }}
        painting={{ seed: '' }}
        onChange={vi.fn()}
        onGenerateRandomSeed={onGenerateRandomSeed}
      />
    )

    const input = screen.getByRole('textbox')
    const reset = screen.getByRole('button', { name: 'common.regenerate' })
    expect(input).toHaveClass('h-8')
    expect(reset).toHaveClass('h-8', 'w-8')

    await userEvent.click(reset)
    expect(onGenerateRandomSeed).toHaveBeenCalledWith('seed')
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

  it('displays an in-range off-grid value until it is edited', () => {
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

    expect(screen.getByRole('spinbutton')).toHaveValue('2.5')
    expect(submitted.numImages).toBeUndefined()
  })
})
