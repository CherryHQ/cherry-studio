import type { PresentationData } from '@aiden0z/pptx-renderer'
import { buildTextIndex } from '@aiden0z/pptx-renderer'
import { loggerService } from '@logger'

const SLIDE_INDEX_ATTRIBUTE = 'data-slide-index'

// Reuses PowerPointFilePreview's context: this module is its excerpt helper, not an independent unit.
const logger = loggerService.withContext('PowerPointFilePreview')

export interface PptxSelectionAnchorResult {
  anchor: { format: 'pptx'; slide: number }
}

/**
 * Maps an element the user picked inside the PPTX slide list to a slide-level anchor.
 * v1 is slide-only: no node/paragraph/table addressing (see the FilePreview README).
 * The excerpt is not read from the DOM — see `slideExcerpt`.
 */
export function slideToPptxAnchor(element: Element): PptxSelectionAnchorResult | null {
  const slideContainer = element.closest(`[${SLIDE_INDEX_ATTRIBUTE}]`)
  if (!(slideContainer instanceof HTMLElement)) return null

  const slideIndex = Number(slideContainer.dataset.slideIndex)
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return null

  return { anchor: { format: 'pptx', slide: slideIndex + 1 } }
}

/**
 * Reads a slide's plain text out of the parsed presentation rather than the rendered DOM, because
 * the excerpt is what `office-transform` compares against `office_extract.py`'s whole-slide extract.
 * The slide element's `textContent` cannot be that: it glues shapes and runs together with no
 * separator ("RoadmapQ3 goals") and carries the bullet characters and zero-width fillers the
 * renderer injects.
 *
 * `office_extract.py` builds one line per `text_frame` paragraph for every shape in
 * `iter_shapes_recursive(slide.shapes)` — the slide's own shapes, never layout or master — plus one
 * line per table row with cells joined by `" | "`. `buildTextIndex` walks shapes in that same order
 * and already joins a shape's paragraphs with a newline, so a shape entry contributes its text
 * verbatim, while table-cell entries (one per cell, in row order) fold back into one line per row.
 *
 * The index also carries the layout/master shapes it renders under `slides/N/{layout,master}/nodes/`
 * when `showMasterSp` is on; python never reads those, so only the slide's own `slides/N/nodes/`
 * subtree counts.
 */
export function slideExcerpt(presentation: PresentationData, slide: number): string {
  const slideData = presentation.slides[slide - 1]
  if (!slideData) return ''

  let entries: ReturnType<typeof buildTextIndex>
  try {
    // Index a one-slide view of the deck: buildTextIndex materialises every lazy slide it is
    // handed, and a pick must not pay for the whole deck. Layout/master/diagram lookups still
    // resolve through the original maps, which the spread keeps.
    entries = buildTextIndex(
      { ...presentation, slides: [slideData] },
      { includeShapes: true, includeTables: true, includeGroups: true }
    ).filter((entry) => entry.slideIndex === 0 && entry.nodePath.startsWith('slides/0/nodes/'))
  } catch (error) {
    // buildTextIndex parses lazy slide XML with no guard of its own, so a single malformed slide can
    // throw out of this click-driven lookup; an empty excerpt already maps to "report null" in handlePick.
    logger.warn('Failed to build PPTX text index for slide excerpt', {
      slide,
      error: error instanceof Error ? error.message : String(error)
    })
    return ''
  }

  const lines: string[] = []
  let openRowKey: string | null = null
  let previousCellIndex = -1
  for (const entry of entries) {
    const rowKey = entry.textKind === 'table-cell' ? `${entry.nodeId} ${entry.rowIndex}` : null
    const cellIndex = entry.cellIndex ?? 0
    if (rowKey !== null && rowKey === openRowKey) {
      // buildTextIndex omits blank cells entirely, so rebuild the row from cellIndex rather than
      // adjacency: pad for any cells it skipped between the last emitted cell and this one.
      const gap = cellIndex - previousCellIndex - 1
      lines[lines.length - 1] += ' | '.repeat(gap + 1) + entry.text
    } else {
      lines.push(' | '.repeat(rowKey !== null ? cellIndex : 0) + entry.text)
    }
    previousCellIndex = rowKey !== null ? cellIndex : -1
    openRowKey = rowKey
  }
  return lines.join('\n')
}
