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
 * P1-S2a: each injected span is now stamped with `data-branch-id` (load-
 * bearing — `clearSourceHighlight(branchId)` consumes it for targeted
 * removal) and `data-hl` (palette key, drives color via CSS variable).
 * `paintSourceHighlight` clears ONLY the spans belonging to its own branchId
 * before re-painting, so multiple branches can coexist without overwriting
 * each other. UI keeps branches.length ≤ 1 in S2a — the multi-branchId
 * capability is exercised by tests against direct DOM fixtures.
 *
 * Markdown DOM is owned by React. Source blocks are completed (non-streaming)
 * so block.content is stable → ReactMarkdown reconciles to the same virtual
 * DOM and leaves the injected spans alone. The wrap is idempotent per
 * branchId (paint clears that id's spans first, then re-wraps) so re-firing
 * the effect can't double-wrap.
 */

const WRAP_CLASS = 'branch-anchor-highlight'
const STYLE_ELEMENT_ID = 'branch-anchor-highlight-style'
const BLOCK_ID_ATTR = 'data-block-id'
const BRANCH_ID_ATTR = 'data-branch-id'
const COLOR_KEY_ATTR = 'data-hl'

/**
 * CSS-escape a branchId so it's safe to embed in an attribute selector.
 * Branch ids are uuids today (safe), but a defensive escape avoids future
 * landmines if the id generator changes (and is what attribute-selector
 * code is supposed to do — never trust upstream).
 */
function escapeAttrValue(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')
}

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
 * Inject the `.branch-anchor-highlight` style once. P1-S2a: 6-color palette
 * defined as CSS custom properties and resolved per-span via the `data-hl`
 * attribute the wrap function stamps. Concrete `rgb(... / 0.45)` values
 * (Tailwind *-400 stops at 45% alpha) — visually distinct, uniformly soft.
 *
 * `var()` is fine here because these spans are real elements (D-010's
 * `::highlight()`-pseudo-resolution bug doesn't apply to actual DOM nodes).
 * The bare class selector remains as a defensive fallback for spans missing
 * `data-hl` — should never happen post-S2a, but harmless if it does.
 */
function ensureHighlightStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = `
:root {
  --branch-hl-c1: rgb(251 191 36 / 0.45); /* amber-400  — legacy default */
  --branch-hl-c2: rgb(56 189 248 / 0.45); /* sky-400 */
  --branch-hl-c3: rgb(167 139 250 / 0.45); /* violet-400 */
  --branch-hl-c4: rgb(244 114 182 / 0.45); /* pink-400 */
  --branch-hl-c5: rgb(74 222 128 / 0.45); /* green-400 */
  --branch-hl-c6: rgb(251 146 60 / 0.45); /* orange-400 */
}
span.${WRAP_CLASS} { background-color: var(--branch-hl-c1); }
span.${WRAP_CLASS}[${COLOR_KEY_ATTR}="c1"] { background-color: var(--branch-hl-c1); }
span.${WRAP_CLASS}[${COLOR_KEY_ATTR}="c2"] { background-color: var(--branch-hl-c2); }
span.${WRAP_CLASS}[${COLOR_KEY_ATTR}="c3"] { background-color: var(--branch-hl-c3); }
span.${WRAP_CLASS}[${COLOR_KEY_ATTR}="c4"] { background-color: var(--branch-hl-c4); }
span.${WRAP_CLASS}[${COLOR_KEY_ATTR}="c5"] { background-color: var(--branch-hl-c5); }
span.${WRAP_CLASS}[${COLOR_KEY_ATTR}="c6"] { background-color: var(--branch-hl-c6); }
`.trim()
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
 * P1-S2a: every injected span is stamped with `data-branch-id` (consumed by
 * `clearSourceHighlight(branchId)` for targeted removal — LOAD-BEARING) and
 * `data-hl` (palette key, drives color via CSS).
 *
 * Nesting: if a Range overlaps an existing branch's spans, the new wrap may
 * end up nested INSIDE those spans (the flattened Text walker traverses
 * descendants regardless of pre-existing wrappers). This is intentional —
 * `clearSourceHighlight(id)` unwraps by id and lets the other branches'
 * spans stay where they are; `parent.normalize()` then merges the freed
 * Text fragments cleanly.
 */
function wrapRangeWithSpans(blockEl: Element, range: Range, branchId: string, colorKey: string): HTMLSpanElement[] {
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
    span.setAttribute(BRANCH_ID_ATTR, branchId)
    span.setAttribute(COLOR_KEY_ATTR, colorKey)
    parent.insertBefore(span, target)
    span.appendChild(target)
    spans.push(span)
  }

  return spans
}

/**
 * Unwrap the previously-injected highlight spans belonging to ONE branch
 * id, restoring the DOM around them byte-for-byte. P1-S2a: targeted by
 * branchId — other branches' spans are not touched (count, text, attrs all
 * unchanged). Idempotent and safe to call repeatedly or when nothing is
 * highlighted for that id.
 *
 * Always queries the LIVE document — stored span references from a prior
 * wrap are invalidated by React reconciliation, which is why the previous
 * insertBefore-loop + removeChild pair leaked both
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
 * original character/node structure exactly — UNLESS another branch's spans
 * sit between the freed Text fragments, in which case those spans stay put
 * and only the Text immediately around them merges (still byte-identical
 * to "this branch was never painted there").
 */
export function clearSourceHighlight(branchId: string): void {
  const selector = `span.${WRAP_CLASS}[${BRANCH_ID_ATTR}="${escapeAttrValue(branchId)}"]`
  const spans = document.querySelectorAll(selector)
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
 * `<span class="branch-anchor-highlight">`, stamping each span with the
 * given `branchId` (load-bearing — targeted clear consumes it) and
 * `colorKey` (drives palette CSS variable). Always clears prior spans of
 * the SAME branchId first, so re-painting one branch is idempotent and
 * non-accumulating. Spans of OTHER branches are left alone — paint(A) does
 * not touch B's spans.
 */
export function paintSourceHighlight(
  blockEl: Element,
  start: number,
  end: number,
  branchId: string,
  colorKey: string
): void {
  clearSourceHighlight(branchId)

  const range = resolveBranchHighlightRange(blockEl, start, end)
  if (!range) return

  ensureHighlightStyle()
  wrapRangeWithSpans(blockEl, range, branchId, colorKey)
}
