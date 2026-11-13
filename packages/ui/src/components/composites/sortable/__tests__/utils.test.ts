// @vitest-environment jsdom
import type { PointerSensorProps } from '@dnd-kit/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlurCancelPointerSensor } from '../utils'

/** Drives a real sensor instance through a pointerdown so its dnd-kit listeners are attached. */
function startDrag() {
  const target = document.createElement('div')
  document.body.append(target)

  const callbacks = {
    onAbort: vi.fn(),
    onCancel: vi.fn(),
    onEnd: vi.fn(),
    onMove: vi.fn(),
    onPending: vi.fn(),
    onStart: vi.fn()
  }

  target.addEventListener('pointerdown', (event) => {
    new BlurCancelPointerSensor({
      ...callbacks,
      active: 'item-1',
      activeNode: { id: 'item-1', node: { current: target } },
      context: { current: {} },
      event,
      options: {}
    } as unknown as PointerSensorProps)
  })
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))

  return callbacks
}

describe('BlurCancelPointerSensor', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('cancels the drag when the window loses focus before any pointerup', () => {
    const callbacks = startDrag()

    window.dispatchEvent(new Event('blur'))

    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
  })

  it('stops following the pointer after a blur cancel', () => {
    const callbacks = startDrag()

    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 200 }))

    expect(callbacks.onMove).not.toHaveBeenCalled()
  })

  it('leaves a completed drag alone when the window loses focus afterwards', () => {
    const callbacks = startDrag()

    document.dispatchEvent(new MouseEvent('pointerup'))
    window.dispatchEvent(new Event('blur'))

    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })
})
