import type { KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { getVerticalSplitterProps } from '../splitterA11y'

const make = (overrides: Partial<Parameters<typeof getVerticalSplitterProps>[0]> = {}) =>
  getVerticalSplitterProps({ width: 200, min: 100, max: 400, label: 'Resize panel', onResize: vi.fn(), ...overrides })

function press(props: ReturnType<typeof getVerticalSplitterProps>, key: string) {
  const event = { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
  props.onKeyDown(event)
  return event
}

describe('getVerticalSplitterProps', () => {
  it('exposes WAI-ARIA separator semantics with current/min/max + a label', () => {
    const props = make()
    expect(props.role).toBe('separator')
    expect(props['aria-orientation']).toBe('vertical')
    expect(props['aria-valuenow']).toBe(200)
    expect(props['aria-valuemin']).toBe(100)
    expect(props['aria-valuemax']).toBe(400)
    expect(props['aria-label']).toBe('Resize panel')
    expect(props.tabIndex).toBe(0)
  })

  it('nudges by one step on Arrow keys and jumps to min/max on Home/End (right-edge default)', () => {
    const onResize = vi.fn()
    const props = make({ onResize })

    expect(press(props, 'ArrowRight').preventDefault).toHaveBeenCalled()
    expect(onResize).toHaveBeenLastCalledWith(216)
    press(props, 'ArrowLeft')
    expect(onResize).toHaveBeenLastCalledWith(184)
    press(props, 'Home')
    expect(onResize).toHaveBeenLastCalledWith(100)
    press(props, 'End')
    expect(onResize).toHaveBeenLastCalledWith(400)
  })

  it('inverts the arrow direction for a left-edge handle (ArrowLeft grows)', () => {
    const onResize = vi.fn()
    const props = make({ onResize, invert: true })

    press(props, 'ArrowLeft')
    expect(onResize).toHaveBeenLastCalledWith(216)
    press(props, 'ArrowRight')
    expect(onResize).toHaveBeenLastCalledWith(184)
  })

  it('ignores unrelated keys without preventing default', () => {
    const onResize = vi.fn()
    const props = make({ onResize })

    const event = press(props, 'Enter')
    expect(onResize).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
