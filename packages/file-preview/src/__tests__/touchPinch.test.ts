import { describe, expect, it, vi } from 'vitest'

import { attachTouchPinch } from '../touchPinch'
import { dispatchTouch } from './touchEvents'

describe('touch pinch', () => {
  it('reports each step relative to the last and keeps the page from zooming', () => {
    const element = document.createElement('div')
    const onPinch = vi.fn()
    attachTouchPinch(element, onPinch)

    dispatchTouch(element, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    const spread = dispatchTouch(element, 'touchmove', [
      [0, 0],
      [200, 0]
    ])
    dispatchTouch(element, 'touchmove', [
      [0, 0],
      [100, 0]
    ])

    expect(spread.defaultPrevented).toBe(true)
    expect(onPinch.mock.calls).toEqual([
      [2, [100, 0]],
      [0.5, [50, 0]]
    ])
  })

  it('leaves one-finger scrolling and the gesture after a finger lifts to the browser', () => {
    const element = document.createElement('div')
    const onPinch = vi.fn()
    attachTouchPinch(element, onPinch)

    dispatchTouch(element, 'touchstart', [[0, 0]])
    const scroll = dispatchTouch(element, 'touchmove', [[0, 50]])
    dispatchTouch(element, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    dispatchTouch(element, 'touchend', [[0, 0]])
    dispatchTouch(element, 'touchmove', [
      [0, 0],
      [300, 0]
    ])

    expect(scroll.defaultPrevented).toBe(false)
    expect(onPinch).not.toHaveBeenCalled()
  })

  it('stops listening once detached', () => {
    const element = document.createElement('div')
    const onPinch = vi.fn()
    attachTouchPinch(element, onPinch)()

    dispatchTouch(element, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    dispatchTouch(element, 'touchmove', [
      [0, 0],
      [200, 0]
    ])

    expect(onPinch).not.toHaveBeenCalled()
  })
})
