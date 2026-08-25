import type { DocumentAnchor } from '@renderer/types/selectionReference'

/**
 * Derives a PDF page anchor + plain-text excerpt from the current DOM
 * selection inside the pdf.js viewer. Returns null when the selection is
 * collapsed or doesn't land inside a rendered page (`[data-page-number]`,
 * pdf.js's own 1-based page marker on each `.page` div).
 *
 * Cross-page selections are clipped to the start page via Range boundaries
 * rather than string slicing, since text order in the DOM doesn't match
 * reading order across page boundaries.
 */
export function selectionToPdfAnchor(selection: Selection): { anchor: DocumentAnchor; excerpt: string } | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const startNode = range.startContainer
  const startElement = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement
  const pageElement = startElement?.closest('[data-page-number]')
  if (!pageElement) return null

  const page = Number(pageElement.getAttribute('data-page-number'))
  if (!Number.isInteger(page) || page <= 0) return null

  const clipped = range.cloneRange()
  if (!pageElement.contains(range.endContainer)) {
    clipped.setEndAfter(pageElement)
  }

  const excerpt = clipped.toString()
  // A selection that starts at the very end of a page and runs into the next one clips to nothing.
  // Reporting a reference whose excerpt is empty would put a chip on screen that quotes no text.
  if (excerpt.length === 0) return null

  return { anchor: { format: 'pdf', page }, excerpt }
}
