import { makeSvgSizeAdaptive } from '@renderer/utils'
import DOMPurify from 'dompurify'

/**
 * Renders an SVG string inside a host element's Shadow DOM to ensure style encapsulation.
 * This function handles creating the shadow root, injecting base styles for the host,
 * and safely parsing and appending the SVG content.
 *
 * @param svgContent The SVG string to render.
 * @param hostElement The container element that will host the Shadow DOM.
 * @throws An error if the SVG content is invalid or cannot be parsed.
 */
export function renderSvgInShadowHost(svgContent: string, hostElement: HTMLElement): void {
  if (!hostElement) {
    throw new Error('Host element for SVG rendering is not available.')
  }

  // Sanitize the SVG content
  const sanitizedContent = DOMPurify.sanitize(svgContent, {
    ADD_TAGS: ['animate', 'foreignObject', 'use'],
    ADD_ATTR: ['from', 'to']
  })

  const shadowRoot = hostElement.shadowRoot || hostElement.attachShadow({ mode: 'open' })

  // Base styles for the host element and the inner SVG
  const style = document.createElement('style')
  style.textContent = `
    :host {
      --shadow-host-background-color: white;
      --shadow-host-border: 0.5px solid var(--color-code-background);
      --shadow-host-border-radius: 8px;

      background-color: var(--shadow-host-background-color);
      border: var(--shadow-host-border);
      border-radius: var(--shadow-host-border-radius);
      padding: 1em;
      overflow: hidden; /* Prevent scrollbars, as scaling is now handled */
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }
  `

  // Clear previous content and append new style
  shadowRoot.innerHTML = ''
  shadowRoot.appendChild(style)

  if (sanitizedContent.trim() === '') {
    return
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(sanitizedContent, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  let svgElement: Element = doc.documentElement

  // If parsing fails or the namespace is incorrect, fall back to the more lenient HTML parser.
  if (parserError || svgElement.namespaceURI !== 'http://www.w3.org/2000/svg') {
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = sanitizedContent
    const svgFromHtml = tempDiv.querySelector('svg')

    if (svgFromHtml) {
      // Directly use the DOM node created by the HTML parser.
      svgElement = svgFromHtml
      // Ensure the xmlns attribute is present.
      svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    } else {
      // If both parsing methods fail, the SVG content is genuinely invalid.
      if (parserError) {
        throw new Error(`SVG parsing error: ${parserError.textContent || 'Unknown parsing error'}`)
      }
      throw new Error('Invalid SVG content: The provided string does not contain a valid SVG element.')
    }
  }

  // Type guard
  if (svgElement instanceof SVGSVGElement) {
    // Standardize the SVG element for proper scaling
    makeSvgSizeAdaptive(svgElement)

    // Append the SVG element to the shadow root
    shadowRoot.appendChild(svgElement)
  } else {
    // This path is taken if the content is valid XML but not a valid SVG document
    // (e.g., root element is not <svg>), or if the fallback parser fails.
    throw new Error('Invalid SVG content: The provided string is not a valid SVG document.')
  }
}
