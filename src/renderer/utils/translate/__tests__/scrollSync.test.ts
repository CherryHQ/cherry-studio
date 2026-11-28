import { describe, expect, it } from 'vitest'

import { createOutputScrollHandler } from '../scrollSync'

describe('createOutputScrollHandler', () => {
  const createElementWithScrollMetrics = (scrollHeight: number, clientHeight: number, scrollTop = 0) => {
    const element = document.createElement('div')
    element.scrollTop = scrollTop
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight })
    return element
  }

  const createScrollFixture = (isProgrammaticScroll = false) => {
    const source = createElementWithScrollMetrics(240, 120, 20)
    const input = createElementWithScrollMetrics(300, 150)
    const sourceRef = { current: source }
    const inputRef = { current: input }
    const isProgrammaticScrollRef = { current: isProgrammaticScroll }

    return { sourceRef, input, inputRef, isProgrammaticScrollRef }
  }

  it('syncs the proportional scroll position from source to target', () => {
    const { sourceRef, input, inputRef, isProgrammaticScrollRef } = createScrollFixture()
    const onScroll = createOutputScrollHandler(sourceRef, inputRef, isProgrammaticScrollRef, true)
    onScroll()

    // ratio = 20 / (240 - 120) = 1/6; target position = 1/6 * (300 - 150) = 25.
    expect(input.scrollTop).toBe(25)
  })

  it.each([
    ['top', 0, 0],
    ['bottom', 120, 150]
  ])('maps the source %s boundary to the target', (_name, sourceScrollTop, expectedTargetScrollTop) => {
    const { sourceRef, input, inputRef, isProgrammaticScrollRef } = createScrollFixture()
    input.scrollTop = 75
    sourceRef.current.scrollTop = sourceScrollTop
    const onScroll = createOutputScrollHandler(sourceRef, inputRef, isProgrammaticScrollRef, true)
    onScroll()

    expect(input.scrollTop).toBe(expectedTargetScrollTop)
  })

  it.each([
    ['scroll sync is disabled', false, false],
    ['the programmatic scroll guard is active', true, true]
  ])('short-circuits when %s', (_name, isProgrammaticScroll, isScrollSyncEnabled) => {
    const { sourceRef, input, inputRef, isProgrammaticScrollRef } = createScrollFixture(isProgrammaticScroll)
    const onScroll = createOutputScrollHandler(sourceRef, inputRef, isProgrammaticScrollRef, isScrollSyncEnabled)
    onScroll()

    expect(input.scrollTop).toBe(0)
  })
})
