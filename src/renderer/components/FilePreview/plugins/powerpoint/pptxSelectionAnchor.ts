import type { PresentationData, SlideNode, TableCell, TextBody, TextIndexEntry } from '@aiden0z/pptx-renderer'
import { buildTextIndex, materializeSlideNodes } from '@aiden0z/pptx-renderer'

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

/** python-pptx's `paragraph.text`, per paragraph: one line each, its runs concatenated. */
function paragraphLines(textBody: TextBody): string[] {
  return textBody.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
}

/** python-pptx's `cell.text`: the cell's paragraphs joined by a newline, empty when it holds no text body. */
function cellText(cell: TableCell): string {
  return cell.textBody ? paragraphLines(cell.textBody).join('\n') : ''
}

// buildTextIndex names a slide node by id, then name, then its position in `nodes`.
const nodeKey = (node: SlideNode, index: number): string => node.id || node.name || String(index)

/**
 * Folds text index entries back into one line per shape and one per table row. The index drops every
 * cell whose text trims to empty, so a row is rebuilt from `cellIndex` rather than from adjacency:
 * pad for the cells it skipped before this one. Trailing empty cells and entirely blank rows are
 * unrecoverable here, which is why only groups — whose children the model keeps as raw XML — still
 * go through the index.
 */
function indexLines(entries: TextIndexEntry[]): string[] {
  const lines: string[] = []
  let openRowKey: string | null = null
  let previousCellIndex = -1
  for (const entry of entries) {
    const rowKey = entry.textKind === 'table-cell' ? `${entry.nodeId} ${entry.rowIndex}` : null
    const cellIndex = entry.cellIndex ?? 0
    if (rowKey !== null && rowKey === openRowKey) {
      const gap = cellIndex - previousCellIndex - 1
      lines[lines.length - 1] += ' | '.repeat(gap + 1) + entry.text
    } else {
      lines.push(' | '.repeat(rowKey !== null ? cellIndex : 0) + entry.text)
    }
    previousCellIndex = rowKey !== null ? cellIndex : -1
    openRowKey = rowKey
  }
  return lines
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
 * line per table row with cells joined by `" | "`. So this materialises the slide's nodes and walks
 * them in that same order: a shape contributes one line per paragraph (empty paragraphs included), a
 * table one line per row over every cell (empty cells included), and other node types nothing.
 *
 * Only a group falls back to `buildTextIndex`, filtered to that group's subtree: the model keeps a
 * group's children as raw XML, so the index is the only reader for them — and it drops blank cells,
 * so a trailing empty cell or an entirely blank row inside a group is lost.
 */
export function slideExcerpt(presentation: PresentationData, slide: number): string {
  const slideData = presentation.slides[slide - 1]
  if (!slideData) return ''

  try {
    materializeSlideNodes(presentation, slideData)

    let groupEntries: TextIndexEntry[] | null = null
    const lines: string[] = []
    for (const [index, node] of slideData.nodes.entries()) {
      switch (node.nodeType) {
        case 'shape':
          if (node.textBody) lines.push(...paragraphLines(node.textBody))
          break
        case 'table':
          for (const row of node.rows) lines.push(row.cells.map(cellText).join(' | '))
          break
        case 'group': {
          // Index a one-slide view of the deck, once: a pick must not pay to index the whole deck.
          // Layout/master/diagram lookups still resolve through the original maps, which the spread keeps.
          const entries = (groupEntries ??= buildTextIndex(
            { ...presentation, slides: [slideData] },
            { includeShapes: true, includeTables: true, includeGroups: true }
          ))
          const prefix = `slides/0/nodes/${nodeKey(node, index)}/`
          lines.push(...indexLines(entries.filter((entry) => entry.nodePath.startsWith(prefix))))
          break
        }
      }
    }
    return lines.join('\n')
  } catch (error) {
    // Both calls parse lazy slide XML with no guard of their own, so one malformed slide can throw out
    // of this click-driven lookup; an empty excerpt already maps to "report null" in handlePick.
    logger.warn('Failed to read PPTX slide text for excerpt', {
      slide,
      error: error instanceof Error ? error.message : String(error)
    })
    return ''
  }
}
