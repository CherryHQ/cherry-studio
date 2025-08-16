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

    svg {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
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
    // Variables for standardizing SVG for proper scaling
    const hasViewBox = svgElement.hasAttribute('viewBox')
    const width = svgElement.getAttribute('width')
    const height = svgElement.getAttribute('height')

    // If viewBox is missing but width and height are present, create a viewBox to make the SVG scalable.
    if (!hasViewBox && width && height) {
      const numericWidth = parseFloat(width)
      const numericHeight = parseFloat(height)
      if (!isNaN(numericWidth) && !isNaN(numericHeight)) {
        svgElement.setAttribute('viewBox', `0 0 ${numericWidth} ${numericHeight}`)
      }
    }

    // Remove fixed width and height to allow CSS to control the element's size
    svgElement.removeAttribute('width')
    svgElement.removeAttribute('height')

    // Append the SVG element to the shadow root
    shadowRoot.appendChild(svgElement.cloneNode(true))
  } else if (svgContent.trim() !== '') {
    // Do not throw error for empty content
    throw new Error('Invalid SVG content: The provided string is not a valid SVG document.')
  }
}
