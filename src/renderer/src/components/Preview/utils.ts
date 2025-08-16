import { makeSvgScalable } from '@renderer/utils'

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

  const shadowRoot = hostElement.shadowRoot || hostElement.attachShadow({ mode: 'open' })

  // Base styles for the host element and the inner SVG
  const style = document.createElement('style')
  style.textContent = `
    :host {
      padding: 1em;
      background-color: white;
      overflow: hidden; /* Prevent scrollbars, as scaling is now handled */
      border: 0.5px solid var(--color-code-background);
      border-radius: 8px;
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }
  `

  // Clear previous content and append new style
  shadowRoot.innerHTML = ''
  shadowRoot.appendChild(style)

  if (svgContent.trim() === '') {
    return
  }

  // Parse and append the SVG using DOMParser to prevent script execution and check for errors
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    // Throw a specific error that can be caught by the calling component
    throw new Error(`SVG parsing error: ${parserError.textContent || 'Unknown parsing error'}`)
  }

  const svgElement = doc.documentElement
  if (svgElement && svgElement.nodeName.toLowerCase() === 'svg') {
    // Standardize the SVG element for proper scaling
    makeSvgScalable(svgElement)

    // Append the SVG element to the shadow root
    shadowRoot.appendChild(svgElement.cloneNode(true))
  } else if (svgContent.trim() !== '') {
    // Do not throw error for empty content
    throw new Error('Invalid SVG content: The provided string is not a valid SVG document.')
  }
}
