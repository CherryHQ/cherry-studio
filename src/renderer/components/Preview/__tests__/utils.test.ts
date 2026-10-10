import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { renderSvgInShadowHost } from '../utils'

describe('renderSvgInShadowHost', () => {
  let hostElement: HTMLElement

  beforeEach(() => {
    hostElement = document.createElement('div')
    document.body.appendChild(hostElement)
  })

  afterEach(() => {
    hostElement.remove()
  })

  it('renders into one shadow root and replaces the previous diagram', () => {
    renderSvgInShadowHost('<svg id="first" width="100" height="50"></svg>', hostElement)
    const shadowRoot = hostElement.shadowRoot!

    expect(shadowRoot.querySelector('style')).toBeInTheDocument()
    expect(shadowRoot.querySelector('#first')).toBeInTheDocument()

    renderSvgInShadowHost('<svg id="second"></svg>', hostElement)

    expect(hostElement.shadowRoot).toBe(shadowRoot)
    expect(shadowRoot.querySelector('#first')).not.toBeInTheDocument()
    expect(shadowRoot.querySelector('#second')).toBeInTheDocument()
  })

  it('sanitizes executable SVG content before rendering', () => {
    renderSvgInShadowHost(
      '<svg><script>alert(1)</script><rect width="10" height="10" onload="alert(1)" /></svg>',
      hostElement
    )

    expect(hostElement.shadowRoot?.querySelector('script')).not.toBeInTheDocument()
    expect(hostElement.shadowRoot?.querySelector('rect')).not.toHaveAttribute('onload')
  })

  it('accepts malformed SVG that the browser can safely repair', () => {
    renderSvgInShadowHost('<svg><rect></svg>', hostElement)

    expect(hostElement.shadowRoot?.querySelector('svg')).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
    expect(hostElement.shadowRoot?.querySelector('rect')).toBeInTheDocument()
  })

  it('rejects content without an SVG document', () => {
    expect(() => renderSvgInShadowHost('<div>not an image</div>', hostElement)).toThrow(
      'Invalid SVG content: The provided string does not contain a valid SVG element.'
    )
  })
})
