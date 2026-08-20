const SLIDE_INDEX_ATTRIBUTE = 'data-slide-index'

export interface PptxSelectionAnchorResult {
  anchor: { format: 'pptx'; slide: number }
  excerpt: string
}

/**
 * Maps a DOM selection inside the PPTX slide list to a slide-level anchor.
 * v1 is slide-only: no node/paragraph/table addressing (see plugin README).
 */
export function selectionToPptxAnchor(selection: Selection | null): PptxSelectionAnchorResult | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const { startContainer } = selection.getRangeAt(0)
  const startElement = startContainer instanceof Element ? startContainer : startContainer.parentElement
  const slideContainer = startElement?.closest(`[${SLIDE_INDEX_ATTRIBUTE}]`)
  if (!(slideContainer instanceof HTMLElement)) return null

  const slideIndex = Number(slideContainer.dataset.slideIndex)
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return null

  return {
    anchor: { format: 'pptx', slide: slideIndex + 1 },
    excerpt: selection.toString()
  }
}
