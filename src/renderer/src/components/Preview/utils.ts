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

  // Base styles for the host element
  const style = document.createElement('style')
  style.textContent = `
    :host {
      padding: 1em;
      background-color: white;
      overflow: auto;
      border: 0.5px solid var(--color-code-background);
      border-radius: 8px;
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }
    svg {
      max-width: 100%;
      height: auto;
    }
  `

  // Clear previous content and append new style and SVG
  shadowRoot.innerHTML = ''
  shadowRoot.appendChild(style)

  // Parse and append the SVG using DOMParser to prevent script execution and check for errors
  if (svgContent.trim() === '') {
    return
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    // Throw a specific error that can be caught by the calling component
    throw new Error(`SVG parsing error: ${parserError.textContent || 'Unknown parsing error'}`)
  }

  const svgElement = doc.documentElement
  if (svgElement && svgElement.nodeName.toLowerCase() === 'svg') {
    shadowRoot.appendChild(svgElement.cloneNode(true))
  } else if (svgContent.trim() !== '') {
    // Do not throw error for empty content
    throw new Error('Invalid SVG content: The provided string is not a valid SVG document.')
  }
}
