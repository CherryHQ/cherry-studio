// @vitest-environment jsdom
import type { PointerSensorProps } from '@dnd-kit/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlurCancelPointerSensor, PortalSafePointerSensor } from '../utils'

type NativePointerEvent = Pick<globalThis.PointerEvent, 'button' | 'isPrimary'> & { target: EventTarget }
type ActivatorEvent = { nativeEvent: NativePointerEvent }
type ActivatorHandler = (
  event: ActivatorEvent,
  context: { onActivation?: (event: { event: unknown }) => void }
) => boolean

const handler = (PortalSafePointerSensor.activators[0] as unknown as { handler: ActivatorHandler }).handler

function pointerDownOn(
  target: EventTarget,
  overrides: Partial<Omit<NativePointerEvent, 'target'>> = {}
): ActivatorEvent {
  return { nativeEvent: { isPrimary: true, button: 0, target, ...overrides } }
}

describe('PortalSafePointerSensor activator', () => {
  it('starts a drag on a primary left-button press', () => {
    expect(handler(pointerDownOn(document.createElement('div')), {})).toBe(true)
  })

  it('does not start a drag on right-click', () => {
    expect(handler(pointerDownOn(document.createElement('div'), { button: 2 }), {})).toBe(false)
  })

  it('does not start a drag on middle-click', () => {
    expect(handler(pointerDownOn(document.createElement('div'), { button: 1 }), {})).toBe(false)
  })

  it('does not start a drag for a non-primary pointer', () => {
    expect(handler(pointerDownOn(document.createElement('div'), { isPrimary: false }), {})).toBe(false)
  })

  it('does not start a drag inside a no-dnd portal', () => {
    const portal = document.createElement('div')
    portal.dataset.noDnd = 'true'
    const child = document.createElement('button')
    portal.appendChild(child)

    expect(handler(pointerDownOn(child), {})).toBe(false)
  })

  it('does not start a drag inside an element marked data-no-dnd', () => {
    const node = document.createElement('div')
    node.dataset.noDnd = 'true'

    expect(handler(pointerDownOn(node), {})).toBe(false)
  })
})

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
