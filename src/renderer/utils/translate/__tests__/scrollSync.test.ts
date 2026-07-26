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

  it('syncs scroll when refs point to scroll containers', () => {
    const source = createElementWithScrollMetrics(240, 120, 20)
    const input = createElementWithScrollMetrics(300, 150)
    const sourceRef = { current: source }
    const inputRef = { current: input }
    const isProgrammaticScrollRef = { current: false }

    const onScroll = createOutputScrollHandler(sourceRef, inputRef, isProgrammaticScrollRef, true)
    onScroll()

    expect(input.scrollTop).toBeGreaterThan(0)
  })

  it('short-circuits when scroll sync is disabled', () => {
    const source = createElementWithScrollMetrics(240, 120, 20)
    const input = createElementWithScrollMetrics(300, 150)
    const sourceRef = { current: source }
    const inputRef = { current: input }
    const isProgrammaticScrollRef = { current: false }

    const onScroll = createOutputScrollHandler(sourceRef, inputRef, isProgrammaticScrollRef, false)
    onScroll()

    expect(input.scrollTop).toBe(0)
  })

  it('short-circuits when programmatic scroll guard is active', () => {
    const source = createElementWithScrollMetrics(240, 120, 20)
    const input = createElementWithScrollMetrics(300, 150)
    const sourceRef = { current: source }
    const inputRef = { current: input }
    const isProgrammaticScrollRef = { current: true }

    const onScroll = createOutputScrollHandler(sourceRef, inputRef, isProgrammaticScrollRef, true)
    onScroll()

    expect(input.scrollTop).toBe(0)
  })
})
