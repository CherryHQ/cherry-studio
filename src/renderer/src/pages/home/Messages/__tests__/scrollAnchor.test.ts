import { describe, expect, it } from 'vitest'

import {
  getAnchorTargetTop,
  getPreservedDisplayCount,
  keepElementTop,
  shouldKeepPreservingAnchor
} from '../scrollAnchor'

describe('scrollAnchor', () => {
  it('adjusts the scroll container by the anchor movement', () => {
    const container = document.createElement('div')
    const anchor = document.createElement('div')
    container.scrollTop = 40

    anchor.getBoundingClientRect = () =>
      ({
        top: 125
      }) as DOMRect

    const didAdjust = keepElementTop(container, anchor, 100)

    expect(didAdjust).toBe(true)
    expect(container.scrollTop).toBe(65)
  })

  it('does not adjust for subpixel drift', () => {
    const container = document.createElement('div')
    const anchor = document.createElement('div')
    container.scrollTop = 40

    anchor.getBoundingClientRect = () =>
      ({
        top: 100.25
      }) as DOMRect

    const didAdjust = keepElementTop(container, anchor, 100)

    expect(didAdjust).toBe(false)
    expect(container.scrollTop).toBe(40)
  })

  it('keeps preserving during the initial anchor window', () => {
    expect(
      shouldKeepPreservingAnchor({
        frameCount: 120,
        hasProcessingResponse: false,
        idleFrames: 120
      })
    ).toBe(true)
  })

  it('keeps preserving while the anchored response is processing', () => {
    expect(
      shouldKeepPreservingAnchor({
        frameCount: 240,
        hasProcessingResponse: true,
        idleFrames: 0
      })
    ).toBe(true)
  })

  it('keeps preserving through the post-processing idle window', () => {
    expect(
      shouldKeepPreservingAnchor({
        frameCount: 240,
        hasProcessingResponse: false,
        idleFrames: 20
      })
    ).toBe(true)
  })

  it('stops preserving after the initial and idle windows finish', () => {
    expect(
      shouldKeepPreservingAnchor({
        frameCount: 240,
        hasProcessingResponse: false,
        idleFrames: 40
      })
    ).toBe(false)
  })

  it('preserves the currently loaded message window when it is larger than the default display count', () => {
    expect(getPreservedDisplayCount(10, 24)).toBe(24)
  })

  it('uses the default display count when no larger message window has been loaded', () => {
    expect(getPreservedDisplayCount(10, 0)).toBe(10)
  })

  it('keeps the current anchor top in preserve mode', () => {
    expect(getAnchorTargetTop({ alignment: 'preserve', anchorTop: 220, containerTop: 80 })).toBe(220)
  })

  it('uses the container top in top alignment mode', () => {
    expect(getAnchorTargetTop({ alignment: 'top', anchorTop: 220, containerTop: 80 })).toBe(80)
  })
})
