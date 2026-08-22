import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BaseConfigItem } from '../baseConfigItem'
import { PaintingFieldRenderer } from '../PaintingFieldRenderer'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

function renderSlider(item: Partial<BaseConfigItem>, painting: Record<string, unknown>) {
  const onChange = vi.fn()
  render(
    <PaintingFieldRenderer
      item={{ type: 'slider', key: 'guidanceScale', ...item } as BaseConfigItem}
      painting={painting}
      onChange={onChange}
    />
  )
  return onChange
}

describe('PaintingFieldRenderer slider input', () => {
  it('accepts a fractional value when the field step is fractional', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '7.5')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 7.5 })
  })

  it('clamps a value above the maximum on blur', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '99')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith({ guidanceScale: 20 })
  })

  it('writes nothing while typing, so the slider never sees a half-typed value', async () => {
    const user = userEvent.setup()
    const onChange = renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '99')

    expect(input).toHaveValue('99')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects letters typed into the field', async () => {
    const user = userEvent.setup()
    renderSlider({ min: 0, max: 20, step: 0.1 }, { guidanceScale: 4.5 })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '1a2')

    expect(input).toHaveValue('12')
  })
})
