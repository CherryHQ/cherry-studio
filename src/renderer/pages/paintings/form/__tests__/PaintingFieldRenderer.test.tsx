import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PaintingFieldRenderer } from '../PaintingFieldRenderer'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('PaintingFieldRenderer range contract', () => {
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
