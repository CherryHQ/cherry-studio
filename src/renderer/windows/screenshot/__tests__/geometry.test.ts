import type { DetectedWindow } from '@shared/types/screenshot'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { OcrTextOverlay } from '../components/OcrTextOverlay'
import { Toolbar } from '../components/Toolbar'
import { mergeLine } from '../hooks/useOcr'
import type { SelectionRect } from '../types'
import { buildAnnotation, isSignificantAnnotation } from '../utils/annotation'
import { findWindowAtPoint } from '../utils/findWindowAtPoint'

function makeWindow(overrides: Partial<DetectedWindow>): DetectedWindow {
  return { title: 'w', x: 0, y: 0, width: 100, height: 100, ...overrides }
}

describe('findWindowAtPoint', () => {
  it('treats the right and bottom edges as outside', () => {
    // Half-open on purpose: with inclusive edges two abutting windows both match and
    // z-order silently picks the one behind.
    const windows = [makeWindow({ x: 0, y: 0, width: 100, height: 100 })]
    expect(findWindowAtPoint(99, 99, windows)).toBe(windows[0])
    expect(findWindowAtPoint(100, 50, windows)).toBeNull()
    expect(findWindowAtPoint(50, 100, windows)).toBeNull()
  })

  it('includes the left and top edges', () => {
    const windows = [makeWindow({ x: 10, y: 20 })]
    expect(findWindowAtPoint(10, 20, windows)).toBe(windows[0])
    expect(findWindowAtPoint(9, 20, windows)).toBeNull()
  })

  it('returns the frontmost window where two overlap', () => {
    // The array arrives sorted front-to-back; picking any other hit would snap to a
    // window buried behind the one the user can see.
    const front = makeWindow({ title: 'front', x: 0, y: 0, width: 200, height: 200 })
    const back = makeWindow({ title: 'back', x: 0, y: 0, width: 400, height: 400 })
    expect(findWindowAtPoint(50, 50, [front, back])).toBe(front)
  })

  it('returns null when nothing is under the point', () => {
    expect(findWindowAtPoint(500, 500, [makeWindow({})])).toBeNull()
  })
})

describe('buildAnnotation', () => {
  const style = { color: '#ff0000', strokeWidth: 4 }

  it('normalizes a rectangle drawn right-to-left and bottom-to-top', () => {
    const annotation = buildAnnotation('rect', { x: 100, y: 100 }, { x: 40, y: 30 }, [], style.color, style.strokeWidth)
    expect(annotation).toEqual({
      type: 'rect',
      color: '#ff0000',
      strokeWidth: 4,
      rect: { x: 40, y: 30, width: 60, height: 70 }
    })
  })

  it('copies the brush path, because the caller keeps mutating the live array', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ]
    const annotation = buildAnnotation('brush', points[0], points[1], points, style.color, style.strokeWidth)
    points.push({ x: 2, y: 2 })
    expect(annotation).toMatchObject({ type: 'brush' })
    expect(annotation?.type === 'brush' && annotation.points).toHaveLength(2)
  })

  it('gives mosaic no colour, since it always paints the capture itself', () => {
    const points = [{ x: 0, y: 0 }]
    const annotation = buildAnnotation('mosaic', points[0], points[0], points, style.color, style.strokeWidth)
    expect(annotation).not.toHaveProperty('color')
  })

  it('produces nothing for the text tool, which is driven by the floating editor', () => {
    expect(buildAnnotation('text', { x: 0, y: 0 }, { x: 1, y: 1 }, [], style.color, style.strokeWidth)).toBeNull()
  })
})

describe('isSignificantAnnotation', () => {
  it('rejects a click-sized rectangle and accepts one pixel larger', () => {
    const rect = (size: number) =>
      ({ type: 'rect', color: '#000', strokeWidth: 4, rect: { x: 0, y: 0, width: size, height: size } }) as const
    expect(isSignificantAnnotation(rect(2))).toBe(false)
    expect(isSignificantAnnotation(rect(3))).toBe(true)
  })

  it('measures an arrow by its length, not by either axis alone', () => {
    const arrow = (end: { x: number; y: number }) =>
      ({ type: 'arrow', color: '#000', strokeWidth: 4, start: { x: 0, y: 0 }, end }) as const
    // 3-4-5 triangle: 5 > 3, so it counts even though neither axis alone would.
    expect(isSignificantAnnotation(arrow({ x: 3, y: 4 }))).toBe(true)
    expect(isSignificantAnnotation(arrow({ x: 2, y: 2 }))).toBe(false)
  })

  it('rejects a single-point brush stroke', () => {
    const stroke = (points: { x: number; y: number }[]) =>
      ({ type: 'brush', color: '#000', strokeWidth: 4, points }) as const
    expect(isSignificantAnnotation(stroke([{ x: 0, y: 0 }]))).toBe(false)
    expect(
      isSignificantAnnotation(
        stroke([
          { x: 0, y: 0 },
          { x: 0, y: 1 }
        ])
      )
    ).toBe(true)
  })

  it('rejects empty text', () => {
    const text = (content: string) =>
      ({ type: 'text', color: '#000', fontSize: 20, position: { x: 0, y: 0 }, content }) as const
    expect(isSignificantAnnotation(text(''))).toBe(false)
    expect(isSignificantAnnotation(text('a'))).toBe(true)
  })
})

describe('Toolbar placement', () => {
  const noop = () => {}
  const actions = {
    activeTool: null,
    canUndo: false,
    canRedo: false,
    onToolChange: noop,
    onUndo: noop,
    onRedo: noop,
    onOk: noop,
    onSave: noop,
    onCancel: noop
  }

  function renderToolbar(selection: SelectionRect, logicalHeight: number) {
    const { container } = render(createElement(Toolbar, { selection, logicalHeight, ...actions }))
    return container.firstElementChild as HTMLElement
  }

  it('keeps the toolbar on screen when the selection covers the whole display', () => {
    // Neither below (no room left) nor above (the selection starts at y=0) fits, and these
    // are the only controls a full-screen capture has — off-screen means Esc or nothing.
    const top = Number.parseFloat(renderToolbar({ x: 0, y: 0, width: 1440, height: 900 }, 900).style.top)
    expect(top).toBeGreaterThanOrEqual(0)
    // 80 = toolbar + gap + property panel, the stack the toolbar reserves room for.
    expect(top + 80).toBeLessThanOrEqual(900)
  })

  it('hangs below a selection that has room underneath it', () => {
    expect(renderToolbar({ x: 0, y: 0, width: 400, height: 300 }, 900).style.top).toBe('308px')
  })
})

describe('OCR text layer placement', () => {
  it('puts a line on the pixels its glyphs occupy, not on the detector padding', () => {
    // A 300×30 physical-pixel run at (120, 90) in the crop, as the detector reports it:
    // grown by 0.4 of its own height per vertical side and 0.6 per horizontal side.
    const detected = { text: 'sample', box: { x: 102, y: 78, width: 336, height: 54 }, confidence: 0.9 }
    const bounds = { x: 40, y: 30, width: 500, height: 200 }

    render(createElement(OcrTextOverlay, { bounds, lines: [mergeLine([detected])], scaleFactor: 2 }))

    const span = screen.getByText('sample')
    const container = span.parentElement as HTMLElement
    // The container carries the crop origin; the span's offsets are region-relative.
    expect(container.style.left).toBe('40px')
    expect(container.style.top).toBe('30px')
    // 120/2 and 90/2. Taking the padded box at face value would place the line at 51 / 39
    // and give it a 27px height — the text layer sitting up and to the left of the words.
    expect(span.style.left).toBe('60px')
    expect(span.style.top).toBe('45px')
    expect(span.style.height).toBe('15px')
    // Width is deliberately not asserted: jsdom reports `scrollWidth` as 0, so the
    // `scaleX(targetWidth / actualWidth)` correction never runs here.
  })
})
