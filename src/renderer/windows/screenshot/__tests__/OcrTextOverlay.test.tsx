import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { OcrTextOverlay } from '../components/OcrTextOverlay'

const BOUNDS = { x: 40, y: 30, width: 500, height: 200 }

/**
 * jsdom implements neither `PointerEvent` nor `caretRangeFromPoint`. A `MouseEvent`
 * carries the `button` / `clientX` / `clientY` the handler reads and travels the same
 * capture path, which is all the drag-lifecycle cases need.
 */
const pointerEvent = (type: string) => new MouseEvent(type, { bubbles: true, button: 0, clientX: 5, clientY: 5 })

describe('OcrTextOverlay', () => {
  beforeEach(() => {
    // Absent in jsdom; null is the "no text here" answer the gap fallback also ends on,
    // so the drag state is exercised without depending on caret resolution.
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => null })
  })

  it('places a line at its recognized box, converted from physical to CSS pixels', () => {
    render(
      <OcrTextOverlay
        bounds={BOUNDS}
        lines={[{ text: 'sample', box: { x: 200, y: 100, width: 400, height: 40 } }]}
        scaleFactor={2}
      />
    )

    // Boxes arrive in physical px while the overlay lays out in CSS px, so a missing division
    // doubles every offset — invisible on a 1× display. No origin added: boxes are region-relative.
    const span = screen.getByText('sample')
    expect(span.style.left).toBe('100px')
    expect(span.style.top).toBe('50px')
    expect(span.style.height).toBe('20px')
    // 85 % of the box height, leaving room for ascenders and descenders inside it.
    expect(span.style.fontSize).toBe('17px')
  })

  it('lets clicks between the lines reach the canvas while the text itself stays selectable', () => {
    render(
      <OcrTextOverlay
        bounds={BOUNDS}
        lines={[{ text: 'sample', box: { x: 0, y: 0, width: 100, height: 20 } }]}
        scaleFactor={1}
      />
    )

    const span = screen.getByText('sample')
    // The layering is functional, not cosmetic: an interactive container would swallow
    // every click in the gaps and make the selection impossible to move or resize.
    expect(span).toHaveClass('pointer-events-auto')
    expect(span.parentElement).toHaveClass('pointer-events-none')
  })

  it('stops taking pointer events while an annotation tool is active', () => {
    render(
      <OcrTextOverlay
        bounds={BOUNDS}
        lines={[{ text: 'sample', box: { x: 0, y: 0, width: 100, height: 20 } }]}
        scaleFactor={1}
        interactive={false}
      />
    )

    // Otherwise the text layer intercepts the strokes the user is drawing.
    expect(screen.getByText('sample')).toHaveClass('pointer-events-none')
  })

  it('releases the layer when a system gesture cancels the drag', () => {
    render(
      <OcrTextOverlay
        bounds={BOUNDS}
        lines={[{ text: 'sample', box: { x: 0, y: 0, width: 100, height: 20 } }]}
        scaleFactor={1}
      />
    )
    const container = screen.getByText('sample').parentElement as HTMLElement

    screen.getByText('sample').dispatchEvent(pointerEvent('pointerdown'))
    expect(container.style.pointerEvents).toBe('auto')

    window.dispatchEvent(pointerEvent('pointercancel'))

    // A cancelled gesture (macOS trackpad takeover) never produces a pointerup, so without the
    // cancel handler the layer stays interactive and swallows every later click on the capture.
    expect(container.style.pointerEvents).toBe('')
  })

  it('ignores a cancel that follows a completed drag', () => {
    render(
      <OcrTextOverlay
        bounds={BOUNDS}
        lines={[{ text: 'sample', box: { x: 0, y: 0, width: 100, height: 20 } }]}
        scaleFactor={1}
      />
    )
    const span = screen.getByText('sample')
    const container = span.parentElement as HTMLElement

    span.dispatchEvent(pointerEvent('pointerdown'))
    window.dispatchEvent(pointerEvent('pointerup'))
    container.style.pointerEvents = 'auto' // a later drag, mid-flight

    window.dispatchEvent(pointerEvent('pointercancel'))

    // The exit is guarded on the drag flag, so a trailing cancel cannot reach in and
    // tear down a drag that has since started.
    expect(container.style.pointerEvents).toBe('auto')
  })
})
