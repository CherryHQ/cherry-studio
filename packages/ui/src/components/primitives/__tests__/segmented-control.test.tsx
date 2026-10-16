// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from '../segmented-control'

const options = [
  { value: 'app', label: 'App' },
  { value: 'window', label: 'Window' },
  { value: 'disabled', label: 'Disabled', disabled: true }
] as const

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

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

  it('names the radiogroup from the caller and each option from its visible label', () => {
    render(<SegmentedControl aria-label="Preview mode" value="app" options={options} />)

    expect(screen.getByRole('radiogroup', { name: 'Preview mode' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'App' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Window' })).toHaveAttribute('aria-checked', 'false')
  })
})
