// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  } as typeof ResizeObserver
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

  it('exposes icon-only options by name and tooltip', async () => {
    const user = userEvent.setup()
    render(
      <SegmentedControl
        defaultValue="app"
        options={[
          {
            value: 'app',
            label: <span aria-hidden>icon</span>,
            ariaLabel: 'Application',
            tooltip: 'Application'
          }
        ]}
      />
    )

    const option = screen.getByRole('radio', { name: 'Application' })
    await user.hover(option)

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Application')
  })
})
