import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WheelStepControl } from '../WheelStepControl'

function ControlledWheelStep({ initialValue = 2 }: { initialValue?: number }) {
  const [value, setValue] = useState(initialValue)

  return (
    <WheelStepControl data-testid="wheel-control" value={value} min={0} max={4} onValueChange={setValue}>
      <span data-testid="value">{value}</span>
    </WheelStepControl>
  )
}

function dispatchWheel(element: HTMLElement, init: WheelEventInit) {
  const event = createEvent.wheel(element, { cancelable: true, ...init })
  fireEvent(element, event)
  return event
}

describe('WheelStepControl', () => {
  it('accumulates trackpad deltas and treats non-pixel deltas as discrete steps', () => {
    const outerWheel = vi.fn()
    render(
      <div onWheel={outerWheel}>
        <ControlledWheelStep />
      </div>
    )

    const control = screen.getByTestId('wheel-control')
    expect(dispatchWheel(control, { deltaY: -15 }).defaultPrevented).toBe(true)
    dispatchWheel(control, { deltaY: -15 })
    expect(screen.getByTestId('value')).toHaveTextContent('2')

    dispatchWheel(control, { deltaY: -15 })
    expect(screen.getByTestId('value')).toHaveTextContent('3')

    dispatchWheel(control, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: -1 })
    expect(screen.getByTestId('value')).toHaveTextContent('4')
    expect(outerWheel).not.toHaveBeenCalled()
  })

  it('preserves page scrolling for modifiers and value boundaries', () => {
    const outerWheel = vi.fn()
    render(
      <div onWheel={outerWheel}>
        <ControlledWheelStep initialValue={4} />
      </div>
    )

    const control = screen.getByTestId('wheel-control')
    const boundaryEvent = dispatchWheel(control, { deltaY: -100 })
    const modifierEvent = dispatchWheel(control, { ctrlKey: true, deltaY: 100 })

    expect(screen.getByTestId('value')).toHaveTextContent('4')
    expect(boundaryEvent.defaultPrevented).toBe(false)
    expect(modifierEvent.defaultPrevented).toBe(false)
    expect(outerWheel).toHaveBeenCalledTimes(2)
  })
})
