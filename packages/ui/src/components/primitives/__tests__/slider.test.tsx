// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { Slider } from '../slider'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

describe('Slider', () => {
  it('uses a white thumb while retaining the control accent track', () => {
    const { container } = render(<Slider defaultValue={[50]} />)

    expect(container.querySelector('[data-slot="slider-range"]')).toHaveClass('bg-control-accent')
    const thumb = container.querySelector('[data-slot="slider-thumb"]')
    expect(thumb).toHaveClass('bg-white', 'ring-inset')
    expect(thumb).not.toHaveClass('bg-background')
  })
})
