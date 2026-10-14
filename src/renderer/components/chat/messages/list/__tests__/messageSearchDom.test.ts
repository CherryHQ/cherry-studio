// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { revealRangeInNestedScrollContainers } from '../messageSearchDom'

function setMetric(
  element: HTMLElement,
  name: 'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollWidth',
  value: number
) {
  Object.defineProperty(element, name, { configurable: true, value })
}

function setRect(element: HTMLElement, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = vi.fn(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect
  }))
}

describe('revealRangeInNestedScrollContainers', () => {
  it('reveals a match through horizontal and message-internal scroll surfaces', () => {
    const outer = document.createElement('div')
    const horizontal = document.createElement('div')
    const content = document.createElement('div')
    const part = document.createElement('div')
    const text = document.createTextNode('target')
    horizontal.style.overflowX = 'auto'
    content.style.overflowY = 'auto'
    part.appendChild(text)
    content.appendChild(part)
    horizontal.appendChild(content)
    outer.appendChild(horizontal)

    setMetric(horizontal, 'clientWidth', 300)
    setMetric(horizontal, 'scrollWidth', 900)
    setMetric(horizontal, 'clientHeight', 300)
    setMetric(horizontal, 'scrollHeight', 300)
    setMetric(content, 'clientWidth', 250)
    setMetric(content, 'scrollWidth', 250)
    setMetric(content, 'clientHeight', 200)
    setMetric(content, 'scrollHeight', 800)
    setRect(horizontal, { left: 0, right: 300, width: 300, top: 0, bottom: 300, height: 300 })
    setRect(content, { left: 500, right: 750, width: 250, top: 0, bottom: 200, height: 200 })

    const range = document.createRange()
    range.selectNodeContents(text)
    range.getBoundingClientRect = vi.fn(
      () => ({ left: 600, right: 650, width: 50, top: 600, bottom: 620, height: 20 }) as DOMRect
    )

    revealRangeInNestedScrollContainers(range, outer)

    expect(content.scrollTop).toBeGreaterThan(0)
    expect(horizontal.scrollLeft).toBeGreaterThan(0)
  })

  it('programmatically reveals clipped grid content', () => {
    const outer = document.createElement('div')
    const gridContent = document.createElement('div')
    const part = document.createElement('div')
    const text = document.createTextNode('target')
    gridContent.style.overflowY = 'hidden'
    part.appendChild(text)
    gridContent.appendChild(part)
    outer.appendChild(gridContent)

    setMetric(gridContent, 'clientWidth', 300)
    setMetric(gridContent, 'scrollWidth', 300)
    setMetric(gridContent, 'clientHeight', 300)
    setMetric(gridContent, 'scrollHeight', 900)
    setRect(gridContent, { left: 0, right: 300, width: 300, top: 0, bottom: 300, height: 300 })

    const range = document.createRange()
    range.selectNodeContents(text)
    range.getBoundingClientRect = vi.fn(
      () => ({ left: 0, right: 50, width: 50, top: 700, bottom: 720, height: 20 }) as DOMRect
    )

    revealRangeInNestedScrollContainers(range, outer)

    expect(gridContent.scrollTop).toBeGreaterThan(0)
  })
})
