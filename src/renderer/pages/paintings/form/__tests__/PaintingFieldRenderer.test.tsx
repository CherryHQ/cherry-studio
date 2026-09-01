import { buildParamsSchema } from '@cherrystudio/provider-registry'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { BaseConfigItem } from '../baseConfigItem'
import { PaintingFieldRenderer } from '../PaintingFieldRenderer'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const GUIDANCE_RANGE: BaseConfigItem = {
  type: 'slider',
  key: 'guidanceScale',
  min: 1,
  max: 20,
  step: 0.1,
  initialValue: 1
}

function ControlledRange({
  item,
  initial,
  onChange
}: {
  item: BaseConfigItem
  initial: number
  onChange?: (updates: Record<string, unknown>) => void
}) {
  const fieldKey = item.key ?? 'value'
  const [painting, setPainting] = useState<Record<string, unknown>>({ [fieldKey]: initial })
  return (
    <PaintingFieldRenderer
      item={item}
      painting={painting}
      onChange={(updates) => {
        onChange?.(updates)
        setPainting((current) => ({ ...current, ...updates }))
      }}
    />
  )
}

describe('PaintingFieldRenderer range contract', () => {
  it('names both controls for the configured range', () => {
    render(
      <PaintingFieldRenderer
        item={{
          type: 'slider',
          key: 'guidanceScale',
          title: 'paintings.guidance_scale',
          min: 1,
          max: 20,
          step: 0.1,
          initialValue: 1
        }}
        painting={{ guidanceScale: 4.5 }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('slider', { name: 'paintings.guidance_scale' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'paintings.guidance_scale' })).toBeInTheDocument()
  })

  it('keeps range numeric inputs compact at w-12 and h-8', () => {
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'guidanceScale', min: 1, max: 20, step: 0.1, initialValue: 16.5 }}
        painting={{ guidanceScale: 16.5 }}
        onChange={vi.fn()}
      />
    )

    // The numeric control must fit the 300px parameter overlay without crowding its slider.
    expect(screen.getByRole('spinbutton')).toHaveClass('w-12', 'h-8')
  })

  it('rejects a typed numImages of 2.5 by snapping onto step 1', () => {
    const onChange = vi.fn()
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'numImages', min: 1, max: 4, step: 1, initialValue: 1 }}
        painting={{ numImages: 1 }}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2.5' } })

    expect(onChange).toHaveBeenCalledWith({ numImages: 3 })
  })

  it('keeps guidanceScale 4.5 on a 0.1 step', () => {
    const onChange = vi.fn()
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'guidanceScale', min: 1, max: 20, step: 0.1, initialValue: 4.5 }}
        painting={{ guidanceScale: 5 }}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4.5' } })

    expect(onChange).toHaveBeenCalledWith({ guidanceScale: 4.5 })
  })

  it('keeps a typed 50.5 on an omitted-step float range', () => {
    const onChange = vi.fn()
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'imageWeight', min: 1, max: 100, initialValue: 50 }}
        painting={{ imageWeight: 50 }}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50.5' } })

    expect(onChange).toHaveBeenCalledWith({ imageWeight: 50.5 })
  })

  it('lets the user type 2.5 through the intermediate 2. on a 0.1 step', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledRange item={GUIDANCE_RANGE} initial={1} onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('2.')

    expect(input).toHaveProperty('value', '2.')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ guidanceScale: 2 })

    await user.keyboard('5')

    expect(input).toHaveProperty('value', '2.5')
    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 2.5 })
    expect(screen.getByTestId('slider')).toHaveProperty('value', '2.5')
  })

  it('lets the user type 0.05 through the intermediate 0.0 on a 0.05 step', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const refStrengthRange: BaseConfigItem = {
      type: 'slider',
      key: 'refStrength',
      min: 0,
      max: 1,
      step: 0.05,
      initialValue: 0.5
    }
    render(<ControlledRange item={refStrengthRange} initial={0.5} onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('0.0')

    expect(input).toHaveProperty('value', '0.0')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ refStrength: 0 })

    await user.keyboard('5')

    expect(input).toHaveProperty('value', '0.05')
    expect(onChange).toHaveBeenLastCalledWith({ refStrength: 0.05 })
    expect(screen.getByTestId('slider')).toHaveProperty('value', '0.05')
  })

  it('shows the committed grid value when typed input snaps', async () => {
    const user = userEvent.setup()
    render(
      <ControlledRange
        item={{ type: 'slider', key: 'numImages', min: 1, max: 4, step: 1, initialValue: 1 }}
        initial={1}
      />
    )

    const input = screen.getByRole('spinbutton')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('2.5')

    expect(input).toHaveProperty('value', '3')
    expect(input).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByTestId('slider')).toHaveProperty('value', '3')
  })

  it('restores the committed value when a cleared field blurs', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledRange item={GUIDANCE_RANGE} initial={4.5} onChange={onChange} />)

    const input = screen.getByRole('spinbutton')
    await user.click(input)
    await user.clear(input)

    expect(input).toHaveProperty('value', '')
    expect(input).not.toHaveAttribute('aria-valuenow')
    expect(onChange).not.toHaveBeenCalled()

    await user.tab()

    expect(input).toHaveProperty('value', '4.5')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces a focused draft when the model value changes from outside', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <PaintingFieldRenderer item={GUIDANCE_RANGE} painting={{ guidanceScale: 1 }} onChange={onChange} />
    )

    const input = screen.getByRole('spinbutton')
    await user.click(input)
    await user.clear(input)
    await user.keyboard('2.')

    expect(input).toHaveProperty('value', '2.')

    rerender(<PaintingFieldRenderer item={GUIDANCE_RANGE} painting={{ guidanceScale: 8 }} onChange={onChange} />)

    expect(input).toHaveProperty('value', '8')
  })

  it('keeps the slider on the declared step when it moves', () => {
    const onChange = vi.fn()
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'numImages', min: 1, max: 4, step: 1, initialValue: 1 }}
        painting={{ numImages: 1 }}
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByTestId('slider'), { target: { value: '2.4' } })

    expect(onChange).toHaveBeenCalledWith({ numImages: 2 })
  })

  it.each([0, -1])('does not pass non-positive step %s to the slider', (step) => {
    render(
      <PaintingFieldRenderer
        item={{ type: 'slider', key: 'strength', min: 0, max: 10, step, initialValue: 4 }}
        painting={{ strength: 4 }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByTestId('slider')).toHaveAttribute('step', '1')
  })

  it('nudges a focused range by its declared step with arrow keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledRange item={GUIDANCE_RANGE} initial={1} onChange={onChange} />)

    await user.click(screen.getByRole('spinbutton'))
    await user.keyboard('{ArrowUp}')

    expect(onChange).toHaveBeenCalledWith({ guidanceScale: 1.1 })
    expect(screen.getByRole('spinbutton')).toHaveProperty('value', '1.1')
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
    // Explicit h-8 on both controls so the reset square matches the compact field.
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

    expect(screen.getByRole('spinbutton')).toHaveDisplayValue('4')
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

    expect(screen.getByRole('spinbutton')).toHaveDisplayValue('4.5')
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

    expect(screen.getByRole('spinbutton')).toHaveDisplayValue('4')
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

    expect(screen.getByRole('spinbutton')).toHaveDisplayValue('1')
    expect(submitted.numImages).toBeUndefined()
  })
})
