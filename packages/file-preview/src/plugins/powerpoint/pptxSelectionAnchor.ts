import type { PresentationData, SlideNode, TableCell, TextBody, TextIndexEntry } from '@aiden0z/pptx-renderer'
import { buildTextIndex, materializeSlideNodes } from '@aiden0z/pptx-renderer'

const SLIDE_INDEX_ATTRIBUTE = 'data-slide-index'

export interface PptxSelectionAnchorResult {
  anchor: { format: 'pptx'; slide: number }
}

export interface PptxPick {
  slide: number
  nodeId?: string
}

export interface PptxSelectionResult {
  anchor: PptxPick & { format: 'pptx' }
  /** Raw model text; `createPreviewSelection` owns normalization and the cap. */
  excerpt: string
}

/**
 * Maps an element the user picked inside the PPTX slide list to a slide-level anchor.
 * The excerpt is not read from the DOM — see `slideExcerpt`.
 */
export function slideToPptxAnchor(element: Element): PptxSelectionAnchorResult | null {
  const slideContainer = element.closest(`[${SLIDE_INDEX_ATTRIBUTE}]`)
  if (!(slideContainer instanceof HTMLElement)) return null

  const value = slideContainer.dataset.slideIndex
  if (!value || !/^\d+$/.test(value)) return null
  const slideIndex = Number(value)
  if (!Number.isInteger(slideIndex) || slideIndex < 0) return null

  return { anchor: { format: 'pptx', slide: slideIndex + 1 } }
}

export function pickPptxSelection(
  element: Element,
  presentation: PresentationData,
  point: { clientX: number; clientY: number },
  onWarning?: (message: string, detail?: unknown) => void
): PptxSelectionResult | null {
  const resolved = slideToPptxAnchor(element)
  if (!resolved) return null
  const { slide } = resolved.anchor
  const slideData = presentation.slides[slide - 1]
  if (!slideData) return null
  const fallback = (): PptxSelectionResult => ({
    anchor: resolved.anchor,
    excerpt: slideExcerpt(presentation, slide, onWarning)
  })
  const item = element.closest(`[${SLIDE_INDEX_ATTRIBUTE}]`)
  const wrapper = item?.firstElementChild
  const root = wrapper?.firstElementChild
  if (!wrapper || !root || !root.contains(element)) return fallback()

  const rect = root.getBoundingClientRect()
  const clip = wrapper.getBoundingClientRect()
  const validRect = (r: DOMRect) =>
    [r.left, r.top, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0
  const inside = (r: DOMRect) =>
    point.clientX >= r.left &&
    point.clientX <= r.left + r.width &&
    point.clientY >= r.top &&
    point.clientY <= r.top + r.height
  if (
    !validRect(rect) ||
    !validRect(clip) ||
    !inside(rect) ||
    !inside(clip) ||
    ![presentation.width, presentation.height].every((n) => Number.isFinite(n) && n > 0)
  )
    return fallback()
  const x = ((point.clientX - rect.left) * presentation.width) / rect.width
  const y = ((point.clientY - rect.top) * presentation.height) / rect.height
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback()

  try {
    materializeSlideNodes(presentation, slideData)
    for (let i = slideData.nodes.length - 1; i >= 0; i--) {
      const node = slideData.nodes[i]
      const { x: left, y: top } = node.position
      const { w, h } = node.size
      if (![left, top, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return fallback()
      // Chart and default renderer wrappers remain axis-aligned.
      const rotates =
        node.nodeType === 'shape' ||
        node.nodeType === 'picture' ||
        node.nodeType === 'table' ||
        node.nodeType === 'group'
      const angle = rotates && Number.isFinite(node.rotation) ? (node.rotation * Math.PI) / 180 : 0
      const dx = x - left - w / 2
      const dy = y - top - h / 2
      const px = dx * Math.cos(angle) + dy * Math.sin(angle) + w / 2
      const py = -dx * Math.sin(angle) + dy * Math.cos(angle) + h / 2
      if (px < 0 || px > w || py < 0 || py > h) continue
      if (node.nodeType === 'shape' && typeof node.id === 'string' && node.id.trim() && node.textBody) {
        return { anchor: { format: 'pptx', slide, nodeId: node.id }, excerpt: paragraphLines(node.textBody).join('\n') }
      }
      return fallback()
    }
  } catch (error) {
    onWarning?.('Failed to resolve PPTX slide selection', {
      slide,
      error: error instanceof Error ? error.message : String(error)
    })
  }
  return fallback()
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
export function slideExcerpt(
  presentation: PresentationData,
  slide: number,
  onWarning?: (message: string, detail?: unknown) => void
): string {
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
    onWarning?.('Failed to read PPTX slide text for excerpt', {
      slide,
      error: error instanceof Error ? error.message : String(error)
    })
    return ''
  }
}
