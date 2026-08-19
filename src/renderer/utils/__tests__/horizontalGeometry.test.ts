import { describe, expect, it } from 'vitest'

import { getHorizontalResizeDelta, getHorizontalResizeOrigin, getHorizontalResizeWidth } from '../horizontalGeometry'

describe('horizontal resize geometry', () => {
  const rect = { left: 100, right: 400 }

  it('measures a right-edge handle from the fixed left edge', () => {
    const origin = getHorizontalResizeOrigin(rect, 400)

    expect(origin).toEqual({ fixedX: 100, handleEdge: 'right' })
    expect(getHorizontalResizeWidth(origin, 450)).toBe(350)
    expect(getHorizontalResizeDelta(origin, 400, 450)).toBe(50)
  })

  it('measures a left-edge handle from the fixed right edge', () => {
    const origin = getHorizontalResizeOrigin(rect, 100)

    expect(origin).toEqual({ fixedX: 400, handleEdge: 'left' })
    expect(getHorizontalResizeWidth(origin, 50)).toBe(350)
    expect(getHorizontalResizeDelta(origin, 100, 50)).toBe(50)
  })

  it('returns a negative delta when either handle shrinks its pane', () => {
    const leftOrigin = getHorizontalResizeOrigin(rect, 100)
    const rightOrigin = getHorizontalResizeOrigin(rect, 400)

    expect(getHorizontalResizeDelta(leftOrigin, 100, 150)).toBe(-50)
    expect(getHorizontalResizeDelta(rightOrigin, 400, 350)).toBe(-50)
  })
})
