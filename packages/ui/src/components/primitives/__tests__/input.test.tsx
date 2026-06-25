// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Input } from '../input'

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

describe('Input', () => {
  it('uses the shared input surface and native time field theme hooks', () => {
    render(
      <>
        <Input placeholder="Search" />
        <Input aria-label="Time" type="time" />
      </>
    )

    const input = screen.getByPlaceholderText('Search')
    const timeInput = screen.getByLabelText('Time')

    expect(input).toHaveClass(
      'border-input',
      'bg-background',
      'rounded-md',
      'focus-visible:border-input',
      'focus-visible:ring-ring/50',
      'focus-visible:ring-[3px]',
      '[color-scheme:light_dark]',
      '[accent-color:var(--color-primary)]'
    )
    expect(timeInput).toHaveClass(
      '[&::-webkit-datetime-edit-hour-field:focus]:bg-primary',
      '[&::-webkit-datetime-edit-hour-field:focus]:text-white',
      '[&::-webkit-datetime-edit-minute-field:focus]:bg-primary',
      '[&::-webkit-datetime-edit-ampm-field:focus]:bg-primary'
    )
  })

  it('opens the time picker and writes selected values back to the input', () => {
    const onChange = vi.fn()

    render(<Input aria-label="Time" type="time" defaultValue="09:00" onChange={onChange} />)

    expect(screen.getByLabelText('Time')).not.toHaveClass('ring-[3px]')

    fireEvent.click(screen.getByLabelText('Open time picker'))

    const selectedHour = screen.getByRole('button', { name: 'Hour 09' })

    expect(screen.getByLabelText('Time')).toHaveClass('ring-ring/50', 'ring-[3px]')
    expect(screen.getByRole('dialog')).toHaveClass('w-75')
    expect(selectedHour).toHaveClass('bg-primary', 'text-white', 'rounded-md', 'w-full')
    expect(selectedHour.parentElement).toHaveClass('pr-2')

    fireEvent.click(screen.getByRole('button', { name: 'Hour 10' }))
    fireEvent.click(screen.getByRole('button', { name: 'PM' }))

    expect(screen.getByLabelText('Time')).toHaveValue('22:00')
    expect(onChange).toHaveBeenCalled()
  })

  it('localizes time picker labels when provided and falls back to English otherwise', () => {
    render(
      <Input
        aria-label="时间"
        type="time"
        defaultValue="09:00"
        timePickerLabels={{ openPicker: '打开时间选择器', hour: '小时', am: '上午', pm: '下午' }}
      />
    )

    fireEvent.click(screen.getByLabelText('打开时间选择器'))

    expect(screen.getByRole('button', { name: '小时 09' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上午' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下午' })).toBeInTheDocument()
    // Unspecified labels keep their English defaults.
    expect(screen.getByRole('button', { name: 'Minute 00' })).toBeInTheDocument()
  })
})
