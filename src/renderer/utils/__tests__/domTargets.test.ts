import { describe, expect, it } from 'vitest'

import { getEventTargetElement, getEventTargetNode, isElementNode } from '../dom'

describe('native DOM event targets', () => {
  it('retains Text identity for containment and resolves its owning Element', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com'
    const text = document.createTextNode('link')
    anchor.append(text)

    expect(getEventTargetNode(text)).toBe(text)
    expect(anchor.contains(getEventTargetNode(text))).toBe(true)
    expect(getEventTargetElement(text)).toBe(anchor)
    expect(isElementNode(text)).toBe(false)
    expect(isElementNode(anchor)).toBe(true)
  })

  it('retains nodes created in another window after adoption', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    try {
      const foreignDocument = frame.contentDocument!
      const anchor = foreignDocument.createElement('a')
      anchor.href = 'https://example.com/adopted'
      const text = foreignDocument.createTextNode('adopted')
      anchor.append(text)
      document.adoptNode(anchor)

      expect(anchor.ownerDocument).toBe(document)
      expect(getEventTargetNode(anchor)).toBe(anchor)
      expect(getEventTargetElement(text)).toBe(anchor)
      expect(isElementNode(anchor)).toBe(true)
    } finally {
      frame.remove()
    }
  })

  it('preserves SVG link elements without claiming an HTML anchor', () => {
    const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'a')
    anchor.setAttribute('href', 'https://example.com/svg')

    expect(getEventTargetElement(anchor)?.closest('a[href]')).toBe(anchor)
  })

  it.each([null, window, new EventTarget()])('ignores non-node targets', (target) => {
    expect(getEventTargetNode(target)).toBeNull()
    expect(getEventTargetElement(target)).toBeNull()
  })
})
