// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { DateTimePicker } from '../index'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DateTimePicker', () => {
  it('formats the selected value in the trigger', () => {
    render(
      <DateTimePicker
        defaultValue={new Date(2026, 3, 29, 14, 5, 9)}
        format="yyyy-MM-dd HH:mm:ss"
        placeholder="Pick date"
      />
    )

    expect(screen.getByRole('button')).toHaveTextContent('2026-04-29 14:05:09')
  })

  it('updates hour, minute and second when granularity is second', () => {
    const onChange = vi.fn()

    function ControlledPicker() {
      const [value, setValue] = useState(new Date(2026, 3, 29, 14, 5, 9))
      return (
        <DateTimePicker
          value={value}
          granularity="second"
          open
          onOpenChange={() => {}}
          onChange={(date) => {
            if (date) setValue(date)
            onChange(date)
          }}
        />
      )
    }

    render(<ControlledPicker />)

    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '08' } })
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: '45' } })

    const lastCall = onChange.mock.calls.at(-1)?.[0] as Date
    expect(lastCall.getHours()).toBe(8)
    expect(lastCall.getMinutes()).toBe(30)
    expect(lastCall.getSeconds()).toBe(45)
  })

  it('hides time controls when granularity is day', () => {
    render(<DateTimePicker defaultValue={new Date(2026, 3, 29)} granularity="day" open onOpenChange={() => {}} />)

    expect(screen.queryByLabelText('Hour')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Minute')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Second')).not.toBeInTheDocument()
  })
})
