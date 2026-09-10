// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Calendar } from '../calendar'
import { DirectionProvider } from '../direction'

afterEach(() => {
  cleanup()
})

describe('Calendar', () => {
  it('uses the provider direction for horizontal keyboard navigation', () => {
    render(
      <DirectionProvider dir="rtl">
        <Calendar data-testid="calendar" captionLayout="label" mode="single" month={new Date(2026, 0, 1)} />
      </DirectionProvider>
    )

    const day15 = screen.getByText('15', { selector: 'button' })
    const day16 = screen.getByText('16', { selector: 'button' })

    act(() => day15.focus())
    fireEvent.keyDown(day15, { key: 'ArrowLeft' })

    expect(screen.getByTestId('calendar')).toHaveAttribute('dir', 'rtl')
    expect(day16).toHaveFocus()
  })

  it('does not mirror navigation chevrons that DayPicker already orients for RTL', () => {
    render(
      <DirectionProvider dir="rtl">
        <Calendar captionLayout="label" month={new Date(2026, 0, 1)} navLayout="around" />
      </DirectionProvider>
    )

    const previousIcon = screen.getByRole('button', { name: /previous month/i }).querySelector('svg')

    expect(previousIcon).toHaveClass('lucide-chevron-right')
    expect(previousIcon).not.toHaveClass('rtl:-scale-x-100')
  })
})
