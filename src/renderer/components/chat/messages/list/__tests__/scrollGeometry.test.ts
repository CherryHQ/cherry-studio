import { describe, expect, it } from 'vitest'

import {
  getDistanceToBottom,
  getEffectiveScrollSize,
  getRealBottom,
  isMoreThanOneViewportFromBottom
} from '../scrollGeometry'

describe('scrollGeometry', () => {
  it('excludes artificial bottom inset from the effective scroll size', () => {
    const element = { clientHeight: 400, scrollHeight: 1000 }

    expect(getEffectiveScrollSize(element, 200)).toBe(800)
    expect(getRealBottom(element, 200)).toBe(400)
  })

  it('never reports a real bottom above the viewport start', () => {
    const element = { clientHeight: 400, scrollHeight: 300 }

    expect(getEffectiveScrollSize(element, 100)).toBe(400)
    expect(getRealBottom(element, 100)).toBe(0)
  })

  it('measures distance from the real bottom rather than the spacer bottom', () => {
    const element = { clientHeight: 400, scrollHeight: 1200, scrollTop: 500 }

    expect(getDistanceToBottom(element, 200)).toBe(100)
  })

  it('uses the real bottom for far-from-bottom checks', () => {
    expect(isMoreThanOneViewportFromBottom({ clientHeight: 400, scrollHeight: 1400, scrollTop: 0 }, 400)).toBe(true)
    expect(isMoreThanOneViewportFromBottom({ clientHeight: 400, scrollHeight: 1400, scrollTop: 300 }, 400)).toBe(false)
  })
})
