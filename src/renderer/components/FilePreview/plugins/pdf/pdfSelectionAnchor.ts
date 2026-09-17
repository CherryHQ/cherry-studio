/**
 * Resolves an element the user picked inside the pdf.js viewer to the rendered page around it
 * (`[data-page-number]`, pdf.js's own 1-based page marker on each `.page` div). The excerpt is not
 * read from the DOM: pdf.js text-layer order is not reading order and a page's text layer may not
 * be rendered yet, so the caller fetches it from the document proxy instead.
 */
export function pageToPdfAnchor(element: Element): { page: number } | null {
  const pageElement = element.closest<HTMLElement>('[data-page-number]')
  if (!pageElement) return null

  const page = Number(pageElement.getAttribute('data-page-number'))
  if (!Number.isInteger(page) || page <= 0) return null

  return { page }
}
