// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { RadioGroup, RadioGroupItem } from '../radio-group'

afterEach(cleanup)

describe('RadioGroupItem', () => {
  it('uses the control accent for the checked border and indicator', () => {
    render(
      <RadioGroup defaultValue="selected">
        <RadioGroupItem value="selected" aria-label="Selected option" />
      </RadioGroup>
    )

    const item = screen.getByRole('radio', { name: 'Selected option' })
    expect(item).toHaveClass('data-[state=checked]:border-control-accent')
    expect(item.querySelector('[data-slot=radio-group-indicator] span')).toHaveClass('bg-control-accent', 'size-2')
  })

  it('sizes the indicator with the item', () => {
    render(
      <RadioGroup defaultValue="large">
        <RadioGroupItem value="large" size="lg" aria-label="Large option" />
      </RadioGroup>
    )

    expect(
      screen.getByRole('radio', { name: 'Large option' }).querySelector('[data-slot=radio-group-indicator] span')
    ).toHaveClass('size-2.5')
  })
})
