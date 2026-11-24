import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SelectionHandles } from '../components/SelectionHandles'
import type { OverlayAction } from '../types'

const methods = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const
const originals = new Map(methods.map((method) => [method, Object.getOwnPropertyDescriptor(Element.prototype, method)]))
let captures: WeakMap<Element, number>

beforeEach(() => {
  captures = new WeakMap()
  const implementations = {
    setPointerCapture(this: Element, id: number) {
      captures.set(this, id)
    },
    hasPointerCapture(this: Element, id: number) {
      return captures.get(this) === id
    },
    releasePointerCapture(this: Element) {
      captures.delete(this)
    }
  }
  for (const [name, value] of Object.entries(implementations))
    Object.defineProperty(Element.prototype, name, { configurable: true, value })
})

afterEach(() => {
  cleanup()
  for (const method of methods) {
    const descriptor = originals.get(method)
    if (descriptor) Object.defineProperty(Element.prototype, method, descriptor)
    else Reflect.deleteProperty(Element.prototype, method)
  }
})

function pointer(type: string, clientX = 110, clientY = 220) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: 11 })
  return event
}

function setup() {
  const actions: OverlayAction[] = []
  let backgroundStarts = 0
  const { container } = render(
    <div
      onPointerDown={() => {
        backgroundStarts++
      }}>
      <SelectionHandles
        selection={{ x: 50, y: 60, width: 100, height: 100 }}
        dispatch={(action) => actions.push(action)}
        canvasOrigin={{ left: 10, top: 20 }}
        viewportWidth={800}
        viewportHeight={600}
      />
    </div>
  )
  // Resize strips belong to the canvas interaction and have no independent semantic role.
  const handle = container.firstElementChild!.firstElementChild!
  return { actions, handle, backgroundStarts: () => backgroundStarts }
}

describe('SelectionHandles pointer lifecycle', () => {
  it('captures a resize without starting the canvas selection and finishes once on release', () => {
    const state = setup()
    fireEvent(state.handle, pointer('pointerdown'))
    expect(captures.get(state.handle)).toBe(11)
    expect(state.backgroundStarts()).toBe(0)
    expect(state.actions[0]).toMatchObject({ type: 'POINTER_DOWN_HANDLE', x: 100, y: 200 })

    fireEvent(state.handle, pointer('pointermove', 130, 240))
    expect(state.actions[1]).toEqual({ type: 'POINTER_MOVE', x: 120, y: 220, viewportWidth: 800, viewportHeight: 600 })
    fireEvent(state.handle, pointer('pointerup'))
    expect(captures.has(state.handle)).toBe(false)
    fireEvent(state.handle, pointer('lostpointercapture'))
    fireEvent(state.handle, pointer('pointermove', 150, 260))
    expect(state.actions.slice(2)).toEqual([{ type: 'POINTER_UP' }])
  })

  it.each(['pointercancel', 'lostpointercapture'])('stops resizing after %s without a second completion', (event) => {
    const state = setup()
    fireEvent(state.handle, pointer('pointerdown'))
    fireEvent(state.handle, pointer(event))
    fireEvent(state.handle, pointer('pointerup'))
    fireEvent(state.handle, pointer('pointermove'))
    expect(state.actions.slice(1)).toEqual([{ type: 'POINTER_UP' }])
  })
})
