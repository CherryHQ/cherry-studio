// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { PortalSafePointerSensor } from '../utils'

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
