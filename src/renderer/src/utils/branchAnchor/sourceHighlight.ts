/**
 * T-006D-2B S6' (precise range) — source-passage highlight.
 *
 * A whole assistant reply is a SINGLE MAIN_TEXT block, so block-level tinting
 * washes the entire reply. This module highlights the EXACT selected passage
 * by wrapping the resolved Range's text nodes in `<span>` elements.
 *
 * Capture (`captureSelectionOffsets`) and rebuild (`resolveBranchHighlightRange`)
 * share ONE traversal model — `flattenTextNodes` — so they cannot drift:
 * both treat the block as the document-order concatenation of its descendant
 * Text nodes and address it by absolute character offset.
 *
 * Rendering history (D-013):
 *   1. block-level `bg-accent` className — too pale, washed whole reply.
 *   2. CSS Custom Highlight API (`CSS.highlights` + `::highlight()`) — Range
 *      resolved correctly, `Highlight` registered, but produced NO visible
 *      paint in this Electron/Chromium + markdown-DOM environment despite
 *      `rangeText` matching exactly, `afterSet.has:true / size:1`, etc.
 *   3. (current) `<span>` wrap — the resolved Range's text nodes get
 *      wrapped in `<span class="branch-anchor-highlight">`. The Range still
 *      pinpoints the exact passage; only the final paint step changed.
 *
 * Markdown DOM is owned by React. Source blocks are completed (non-streaming)
 * so block.content is stable → ReactMarkdown reconciles to the same virtual
 * DOM and leaves the injected spans alone. The wrap is idempotent (always
 * `clear` first, then `wrap`) so re-firing the effect can't double-wrap.
 */

const WRAP_CLASS = 'branch-anchor-highlight'
const STYLE_ELEMENT_ID = 'branch-anchor-highlight-style'
const BLOCK_ID_ATTR = 'data-block-id'

/** Walk up to the nearest element carrying `data-block-id`. */
function resolveBlockElement(node: Node | null | undefined): Element | null {
  if (!node) return null
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return start?.closest(`[${BLOCK_ID_ATTR}]`) ?? null
}

/** Descendant Text nodes of `blockEl` in document order — the shared model. */
function flattenTextNodes(blockEl: Element): Text[] {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text)
  }
  return nodes
}

/**
 * Absolute char offset of a (container, offset) boundary point within the
 * flattened text of `blockEl`. Works for both Text-node endpoints (the common
 * case — a Selection lands inside text) and Element-node endpoints (the
 * boundary sits between child nodes).
 */
function charOffsetOfPoint(textNodes: Text[], container: Node, offsetInContainer: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    let acc = 0
    for (const tn of textNodes) {
      if (tn === container) return acc + offsetInContainer
      acc += tn.length
    }
    return acc
  }
  const boundaryChild: Node | null = container.childNodes[offsetInContainer] ?? null
  let acc = 0
  for (const tn of textNodes) {
    if (boundaryChild) {
      if (tn === boundaryChild) break
      const rel = boundaryChild.compareDocumentPosition(tn)
      if (rel & Node.DOCUMENT_POSITION_CONTAINED_BY || rel & Node.DOCUMENT_POSITION_FOLLOWING) break
    } else {
      const rel = container.compareDocumentPosition(tn)
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING && !(rel & Node.DOCUMENT_POSITION_CONTAINED_BY)) break
    }
    acc += tn.length
  }
  return acc
}

/**
 * Capture the selection's char offsets within its source block.
 *
 * Returns null when: collapsed, no `data-block-id` ancestor, the two
 * endpoints fall in different blocks, or the offsets are degenerate.
 */
export function captureSelectionOffsets(range: Range | null | undefined): { start: number; end: number } | null {
  if (!range || range.collapsed) return null

  const startBlock = resolveBlockElement(range.startContainer)
  const endBlock = resolveBlockElement(range.endContainer)
  if (!startBlock || startBlock !== endBlock) return null

  const textNodes = flattenTextNodes(startBlock)
  const start = charOffsetOfPoint(textNodes, range.startContainer, range.startOffset)
  const end = charOffsetOfPoint(textNodes, range.endContainer, range.endOffset)
  if (start >= end) return null

  return { start, end }
}

/**
 * Rebuild a Range from {block, startOffset, endOffset} by walking the SAME
 * flattened text-node model `captureSelectionOffsets` used. Returns null when
 * the offsets fall outside the current text content — callers treat null as
 * "highlight nothing". Exported for round-trip testing.
 */
export function resolveBranchHighlightRange(blockEl: Element, start: number, end: number): Range | null {
  if (start >= end) return null
  const textNodes = flattenTextNodes(blockEl)

  let acc = 0
  let startNode: Text | undefined
  let startNodeOffset = 0
  let endNode: Text | undefined
  let endNodeOffset = 0

  for (const tn of textNodes) {
    const len = tn.length
    if (startNode === undefined && acc + len >= start) {
      startNode = tn
      startNodeOffset = start - acc
    }
    if (endNode === undefined && acc + len >= end) {
      endNode = tn
      endNodeOffset = end - acc
    }
    acc += len
    if (startNode && endNode) break
  }

  if (!startNode || !endNode) return null

  try {
    const range = document.createRange()
    range.setStart(startNode, startNodeOffset)
    range.setEnd(endNode, endNodeOffset)
    return range
  } catch {
    return null
  }
}

/**
 * Inject the `.branch-anchor-highlight` style once. Concrete amber-400 @ 45%
 * (Tailwind, mapped to DESIGN.md `warning` hue family) — not a CSS var, to
 * avoid the D-010 "too pale" regression with `var(--color-warning-bg)`.
 */
function ensureHighlightStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = `span.${WRAP_CLASS} { background-color: rgb(251 191 36 / 0.45); }`
  document.head.appendChild(style)
}

/**
 * Wrap the in-range portion of each Text node intersecting `range` in a
 * `<span class="branch-anchor-highlight">`. Uses `Text.splitText` to peel
 * off the in-range substring of each boundary text node, then moves it into
 * a span. `Range.surroundContents()` cannot be used here because the
 * selection crosses element boundaries (markdown produces nested `<strong>`,
 * `<em>`, `<code>` etc. inside a paragraph) — that's the standard
 * cross-node-Range wrap routine.
 *
 * The trace just proved `range.startContainer` / `range.endContainer` are
 * both Text nodes (`#text`), so the lookup by `indexOf` in the block's
 * flattened text-node list is exact.
 */
function wrapRangeWithSpans(blockEl: Element, range: Range): HTMLSpanElement[] {
  const allTextNodes = flattenTextNodes(blockEl)
  const startNode = range.startContainer as Text
  const endNode = range.endContainer as Text
  const startIdx = allTextNodes.indexOf(startNode)
  const endIdx = allTextNodes.indexOf(endNode)
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return []

  const inRange = allTextNodes.slice(startIdx, endIdx + 1)
  const spans: HTMLSpanElement[] = []

  for (const tn of inRange) {
    const s = tn === startNode ? range.startOffset : 0
    let e = tn === endNode ? range.endOffset : tn.length
    if (s >= e) continue

    // Peel off the in-range substring as its own Text node.
    let target: Text = tn
    if (s > 0) {
      target = tn.splitText(s)
      e -= s
    }
    if (e < target.length) {
      target.splitText(e)
    }
    const parent = target.parentNode
    if (!parent) continue
    const span = document.createElement('span')
    span.className = WRAP_CLASS
    parent.insertBefore(span, target)
    span.appendChild(target)
    spans.push(span)
  }

  return spans
}

/**
 * Unwrap every previously-injected highlight span globally, restoring the
 * DOM byte-for-byte. Idempotent and safe to call repeatedly or when nothing
 * is highlighted. Always queries the LIVE document — stored span references
 * from a prior wrap are invalidated by React reconciliation, which is why
 * the previous insertBefore-loop + removeChild pair leaked both
 *   (a) full spans still containing their text (cleanup missed them), and
 *   (b) empty span shells (children moved out, but `removeChild` was skipped
 *       — e.g. when `span.parentNode` had been detached/replaced between
 *       reading it and calling `parent.removeChild(span)`).
 *
 * `Element.replaceWith(...span.childNodes)` is a single DOM primitive that
 * removes the span element AND inserts its children in place — atomic for
 * our purposes, with no intermediate "empty shell" state. Empty spans
 * collapse to `replaceWith()` (zero args) which just removes the element.
 *
 * `parent.normalize()` afterwards merges the adjacent Text nodes that
 * `splitText` created during wrap, so the post-clear DOM matches the
 * original character/node structure exactly.
 */
export function clearSourceHighlight(): void {
  const spans = document.querySelectorAll(`span.${WRAP_CLASS}`)
  if (spans.length === 0) return
  const parents = new Set<Element>()
  spans.forEach((span) => {
    const parent = span.parentNode
    if (parent === null) return
    // Snapshot children before `replaceWith` consumes them — `span.childNodes`
    // is a live NodeList and would empty out as nodes are moved.
    const children = Array.from(span.childNodes)
    span.replaceWith(...children)
    if (parent instanceof Element) parents.add(parent)
  })
  parents.forEach((p) => p.normalize())
}

/**
 * Paint the precise selected range by wrapping its text nodes in
 * `<span class="branch-anchor-highlight">`. Always clears any prior wrap
 * first, so calling this twice in a row is idempotent (the effect calls
 * paint sync + once in rAF — no double-wrap).
 */
export function paintSourceHighlight(blockEl: Element, start: number, end: number): void {
  clearSourceHighlight()

  const range = resolveBranchHighlightRange(blockEl, start, end)
  if (!range) return

  ensureHighlightStyle()
  wrapRangeWithSpans(blockEl, range)
}
