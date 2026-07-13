import { describe, expect, it } from 'vitest'

import { boundingBox, clusterPosition, hullBounds, withinGroup } from '../groupHull'

describe('groupHull', () => {
  it('boundingBox spans all member rects', () => {
    expect(
      boundingBox([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 50, width: 100, height: 100 }
      ])
    ).toEqual({ x: 0, y: 0, width: 300, height: 150 })
  })

  it('hullBounds pads the bounding box by HULL_PADDING (16)', () => {
    expect(hullBounds([{ x: 0, y: 0, width: 100, height: 100 }])).toEqual({
      x: -16,
      y: -16,
      width: 132,
      height: 132
    })
  })

  it('clusterPosition lays members in a ~square grid (240 + 16 step)', () => {
    expect(clusterPosition({ x: 10, y: 20 }, 0, 2)).toEqual({ x: 10, y: 20 })
    expect(clusterPosition({ x: 10, y: 20 }, 1, 2)).toEqual({ x: 266, y: 20 }) // second column
    expect(clusterPosition({ x: 0, y: 0 }, 2, 4)).toEqual({ x: 0, y: 256 }) // 2 cols → second row
  })

  it('withinGroup: a nearby rect counts as in the group, a far one detaches', () => {
    const region = { x: 0, y: 0, width: 100, height: 100 }
    expect(withinGroup({ x: 120, y: 0, width: 100, height: 100 }, region)).toBe(true) // 20px gap < margin
    expect(withinGroup({ x: 400, y: 0, width: 100, height: 100 }, region)).toBe(false) // far past margin
  })
})
