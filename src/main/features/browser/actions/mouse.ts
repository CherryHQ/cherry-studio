import type { BrowserActionOptions } from '../BrowserCursor'
import type { BrowserRef } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { callOnElement, resolveTarget, withElement } from './resolveTarget'

export async function click(
  session: GuestSession,
  ref: BrowserRef,
  button: 'left' | 'right' | 'middle',
  clickCount: 1 | 2,
  options: BrowserActionOptions
) {
  const point = await resolvePointerTarget(session, ref, options)
  if (point.occluded) {
    options.pointer?.hide()
    if (button !== 'left' || clickCount !== 1) throw new BrowserSessionError('occluded')
    await withElement(
      session,
      ref,
      (objectId) => callOnElement(session, objectId, 'function(){ this.click() }', [], options),
      options
    )
    return { occluded: true, synthetic: true }
  }
  session.resolveRef(ref)
  const { x, y } = point
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, options)
  if (options.pointer) {
    const hit = await resolveTarget(session, ref, options)
    if (hit.occluded || hit.x !== x || hit.y !== y) {
      options.pointer.hide()
      throw new BrowserSessionError('occluded')
    }
  }
  for (let count = 1; count <= clickCount; count++) {
    session.resolveRef(ref)
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count }, options)
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count }, options)
  }
  options.pointer?.pressed()
  return { occluded: false, synthetic: false }
}

export async function hover(session: GuestSession, ref: BrowserRef, options: BrowserActionOptions) {
  const { x, y, occluded } = await resolvePointerTarget(session, ref, options)
  if (occluded) throw new BrowserSessionError('occluded')
  session.resolveRef(ref)
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, options)
}

export async function scroll(
  session: GuestSession,
  ref: BrowserRef | undefined,
  pages: number,
  options: BrowserActionOptions
) {
  const viewport = await session.send(
    'Runtime.evaluate',
    {
      expression: '({w:innerWidth,h:innerHeight})',
      returnByValue: true
    },
    options
  )
  const { w, h } = viewport.result.value
  const point = ref ? await resolveTarget(session, ref, options) : { x: w / 2, y: h / 2, occluded: false }
  if (point.occluded) throw new BrowserSessionError('occluded')
  if (options.pointer) {
    await options.pointer.move(point, options)
    if (ref) Object.assign(point, await resolveTarget(session, ref, options))
    if (point.occluded) throw new BrowserSessionError('occluded')
    options.pointer.update(point)
  }
  if (ref) session.resolveRef(ref)
  await session.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: pages * h },
    options
  )
}

async function resolvePointerTarget(session: GuestSession, ref: BrowserRef, options: BrowserActionOptions) {
  let point = await resolveTarget(session, ref, options)
  if (options.pointer && !point.occluded) {
    if (await options.pointer.move(point, options)) {
      point = await resolveTarget(session, ref, options)
      options.pointer.update(point)
    }
  }
  return point
}
