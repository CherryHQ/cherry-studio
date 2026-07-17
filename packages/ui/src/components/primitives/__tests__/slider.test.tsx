// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

import { Slider } from '../slider'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

describe('Slider', () => {
  it('labels each interactive thumb with semantic value text', () => {
    const labels = ['Low', 'Medium', 'High', 'X-High']

    render(
      <Slider
        value={[1, 3]}
        min={0}
        max={3}
        thumbAriaLabel={(index) => (index === 0 ? 'Minimum effort' : 'Maximum effort')}
        getThumbAriaValueText={(value) => labels[value]}
      />
    )

    expect(screen.getByRole('slider', { name: 'Minimum effort' })).toHaveAttribute('aria-valuetext', 'Medium')
    expect(screen.getByRole('slider', { name: 'Maximum effort' })).toHaveAttribute('aria-valuetext', 'X-High')
  })

  it('selects a single-value slider mark when its label is clicked', () => {
    const onValueChange = vi.fn()
    const onValueCommit = vi.fn()

    render(
      <Slider
        defaultValue={[0]}
        min={0}
        max={2}
        step={1}
        marks={[
          { value: 0, label: 'Low' },
          { value: 1, label: 'Medium' },
          { value: 2, label: 'High' }
        ]}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'High' }))

    expect(onValueChange).toHaveBeenLastCalledWith([2])
    expect(onValueCommit).toHaveBeenLastCalledWith([2])
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2')
  })
})
