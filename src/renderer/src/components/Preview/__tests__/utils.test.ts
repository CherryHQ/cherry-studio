import { renderSvgInShadowHost } from '@renderer/components/Preview/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('renderSvgInShadowHost', () => {
  let hostElement: HTMLElement

  beforeEach(() => {
    hostElement = document.createElement('div')
    document.body.appendChild(hostElement)

    // Mock attachShadow
    Element.prototype.attachShadow = vi.fn().mockImplementation(function (this: HTMLElement) {
      // Check if a shadow root already exists to prevent re-creating it.
      if (this.shadowRoot) {
        return this.shadowRoot
      }

      // Create a container that acts as the shadow root.
      const shadowRootContainer = document.createElement('div')
      shadowRootContainer.dataset.testid = 'shadow-root'

      Object.defineProperty(this, 'shadowRoot', {
        value: shadowRootContainer,
        writable: true,
        configurable: true
      })

      // Mock essential methods like appendChild and innerHTML.
      // JSDOM doesn't fully implement shadow DOM, so we simulate its behavior.
      const originalInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
      Object.defineProperty(shadowRootContainer, 'innerHTML', {
        set(value: string) {
          // Clear existing content and parse the new HTML.
          originalInnerHTMLDescriptor?.set?.call(this, '')
          const template = document.createElement('template')
          template.innerHTML = value
          shadowRootContainer.append(...Array.from(template.content.childNodes))
        },
        get() {
          return originalInnerHTMLDescriptor?.get?.call(this) ?? ''
        },
        configurable: true
      })

      return shadowRootContainer as unknown as ShadowRoot
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
    expect(existingShadowRoot.innerHTML).toContain('<svg')
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

  it('should add the xmlns attribute if it is missing', () => {
    const svgWithoutXmlns = '<svg width="100" height="100"><circle cx="50" cy="50" r="40" /></svg>'
    renderSvgInShadowHost(svgWithoutXmlns, hostElement)

    const svgElement = hostElement.shadowRoot?.querySelector('svg')
    expect(svgElement).not.toBeNull()
    expect(svgElement?.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
  })

  it('should throw an error if the host element is not available', () => {
    expect(() => renderSvgInShadowHost('<svg></svg>', null as any)).toThrow(
      'Host element for SVG rendering is not available.'
    )
  })

  it('should not throw an error for malformed SVG content due to HTML parser fallback', () => {
    const invalidSvg = '<svg><rect></svg>' // Malformed, but fixable by the browser's HTML parser
    expect(() => renderSvgInShadowHost(invalidSvg, hostElement)).not.toThrow()
    // Also, assert that it successfully rendered something.
    expect(hostElement.shadowRoot?.querySelector('svg')).not.toBeNull()
  })

  it('should throw an error for non-SVG content', () => {
    const nonSvg = '<div>this is not svg</div>'
    expect(() => renderSvgInShadowHost(nonSvg, hostElement)).toThrow()
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
