import { describe, expect, it } from 'vitest'

import { keepElementTop } from '../scrollAnchor'

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
})
