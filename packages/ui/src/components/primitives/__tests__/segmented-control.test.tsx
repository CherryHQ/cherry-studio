// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from '../segmented-control'

const options = [
  { value: 'app', label: 'App' },
  { value: 'window', label: 'Window' },
  { value: 'disabled', label: 'Disabled', disabled: true }
] as const

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SegmentedControl', () => {
  it('keeps controlled selection until the value prop changes', () => {
    const onValueChange = vi.fn()

    render(<SegmentedControl value="app" options={options} onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Window' }))

    expect(onValueChange).toHaveBeenCalledWith('window')
    expect(screen.getByRole('radio', { name: 'App' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Window' })).toHaveAttribute('aria-checked', 'false')
  })

  it('does not emit changes for disabled options', () => {
    const onValueChange = vi.fn()

    render(<SegmentedControl defaultValue="app" options={options} onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Disabled' }))

    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'App' })).toHaveAttribute('aria-checked', 'true')
  })
})
