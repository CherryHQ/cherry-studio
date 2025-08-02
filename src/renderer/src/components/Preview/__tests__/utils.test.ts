import { renderSvgInShadowHost } from '@renderer/components/Preview/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('renderSvgInShadowHost', () => {
  let hostElement: HTMLElement

  beforeEach(() => {
    hostElement = document.createElement('div')
    document.body.appendChild(hostElement)

    // Mock attachShadow
    Element.prototype.attachShadow = vi.fn().mockImplementation(function (this: HTMLElement) {
      const shadowRoot = document.createElement('div')
      Object.defineProperty(this, 'shadowRoot', {
        value: shadowRoot,
        writable: true,
        configurable: true
      })
      // Simple innerHTML copy for test verification
      Object.defineProperty(shadowRoot, 'innerHTML', {
        set(value) {
          shadowRoot.textContent = value // A simplified mock
        },
        get() {
          return shadowRoot.textContent || ''
        },
        configurable: true
      })

      shadowRoot.appendChild = vi.fn(<T extends Node>(node: T): T => {
        shadowRoot.append(node)
        return node
      })

      return shadowRoot as unknown as ShadowRoot
    })
  })

  afterEach(() => {
    if (hostElement && hostElement.parentNode) {
      hostElement.parentNode.removeChild(hostElement)
    }
    vi.clearAllMocks()
  })

  it('should attach a shadow root if one does not exist', () => {
    renderSvgInShadowHost('<svg></svg>', hostElement)
    expect(Element.prototype.attachShadow).toHaveBeenCalledWith({ mode: 'open' })
  })

  it('should not attach a new shadow root if one already exists', () => {
    // Attach a shadow root first
    const existingShadowRoot = hostElement.attachShadow({ mode: 'open' })
    vi.clearAllMocks() // Clear the mock call from the setup

    renderSvgInShadowHost('<svg></svg>', hostElement)

    expect(Element.prototype.attachShadow).not.toHaveBeenCalled()
    // Verify it works with the existing shadow root
    expect(existingShadowRoot.appendChild).toHaveBeenCalled()
  })

  it('should inject styles and valid SVG content into the shadow DOM', () => {
    const svgContent = '<svg><rect /></svg>'
    renderSvgInShadowHost(svgContent, hostElement)

    const shadowRoot = hostElement.shadowRoot
    expect(shadowRoot).not.toBeNull()
    expect(shadowRoot?.querySelector('style')).not.toBeNull()
    expect(shadowRoot?.querySelector('svg')).not.toBeNull()
    expect(shadowRoot?.querySelector('rect')).not.toBeNull()
  })

  it('should throw an error if the host element is not available', () => {
    expect(() => renderSvgInShadowHost('<svg></svg>', null as any)).toThrow(
      'Host element for SVG rendering is not available.'
    )
  })

  it('should throw an error for invalid SVG content', () => {
    const invalidSvg = '<svg><rect></svg>' // Malformed
    expect(() => renderSvgInShadowHost(invalidSvg, hostElement)).toThrow(/SVG parsing error/)
  })

  it('should throw an error for non-SVG content', () => {
    const nonSvg = '<div>this is not svg</div>'
    expect(() => renderSvgInShadowHost(nonSvg, hostElement)).toThrow('Invalid SVG content')
  })

  it('should not throw an error for empty or whitespace content', () => {
    expect(() => renderSvgInShadowHost('', hostElement)).not.toThrow()
    expect(() => renderSvgInShadowHost('   ', hostElement)).not.toThrow()
  })

  it('should clear previous content before rendering new content', () => {
    const firstSvg = '<svg id="first"></svg>'
    renderSvgInShadowHost(firstSvg, hostElement)
    expect(hostElement.shadowRoot?.querySelector('#first')).not.toBeNull()

    const secondSvg = '<svg id="second"></svg>'
    renderSvgInShadowHost(secondSvg, hostElement)
    expect(hostElement.shadowRoot?.querySelector('#first')).toBeNull()
    expect(hostElement.shadowRoot?.querySelector('#second')).not.toBeNull()
  })
})
