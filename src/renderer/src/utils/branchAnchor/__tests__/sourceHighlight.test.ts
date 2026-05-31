import { afterEach, describe, expect, it } from 'vitest'

import {
  captureSelectionOffsets,
  clearSourceHighlight,
  paintSourceHighlight,
  resolveBranchHighlightRange
} from '../sourceHighlight'

/**
 * T-006D-2B S6' precise-range highlight — algorithm + paint chain coverage.
 *
 * Two layers are exercised here:
 *   1. capture↔rebuild offsets round-trip (`captureSelectionOffsets` and
 *      `resolveBranchHighlightRange`) — verifies the two halves of the
 *      offset model agree on what range a selection refers to.
 *   2. paint/clear DOM mutation chain (`paintSourceHighlight` and
 *      `clearSourceHighlight`) — wraps text nodes in
 *      `<span class="branch-anchor-highlight">` and unwraps them.
 *
 * jsdom supports Range, TreeWalker, splitText, and Element.replaceWith, so
 * the full DOM-mutation chain runs unmodified here. CSS Custom Highlight
 * API was abandoned (see D-013-FIX-FINAL); only span-wrap is current.
 */

afterEach(() => {
  document.body.innerHTML = ''
  // The paint module installs a `<style id="branch-anchor-highlight-style">`
  // into document.head on first use. Strip it between tests so each one
  // starts from a clean DOM (it gets re-injected on demand by `paint`).
  document.getElementById('branch-anchor-highlight-style')?.remove()
})

/** Build a `data-block-id` block from an HTML string. */
function makeBlock(html: string): Element {
  const block = document.createElement('div')
  block.setAttribute('data-block-id', 'blk-1')
  block.innerHTML = html
  document.body.appendChild(block)
  return block
}

describe('captureSelectionOffsets ↔ resolveBranchHighlightRange round-trip', () => {
  it('captures offsets of a selection inside a single text node and rebuilds the same text', () => {
    const block = makeBlock('Distillation transfers knowledge to a student model.')
    const textNode = block.firstChild as Text
    // Select "transfers knowledge" — chars [13, 32).
    const range = document.createRange()
    range.setStart(textNode, 13)
    range.setEnd(textNode, 32)

    const offsets = captureSelectionOffsets(range)
    expect(offsets).toEqual({ start: 13, end: 32 })

    const rebuilt = resolveBranchHighlightRange(block, offsets!.start, offsets!.end)
    expect(rebuilt?.toString()).toBe('transfers knowledge')
  })

  it('handles a selection spanning multiple inline text nodes', () => {
    // childNodes: [text "teacher passes ", <strong>knowledge</strong>, text " to student"]
    const block = makeBlock('teacher passes <strong>knowledge</strong> to student')
    const leadingText = block.childNodes[0] as Text
    const strongText = block.querySelector('strong')!.firstChild as Text

    // Select "passes knowledge" — starts at index 8 of the leading text node,
    // ends at the end of the <strong> text node.
    const range = document.createRange()
    range.setStart(leadingText, 8)
    range.setEnd(strongText, strongText.length)

    const offsets = captureSelectionOffsets(range)
    expect(offsets).toEqual({ start: 8, end: 24 })

    const rebuilt = resolveBranchHighlightRange(block, offsets!.start, offsets!.end)
    expect(rebuilt?.toString()).toBe('passes knowledge')
  })

  it('returns null when the selection has no data-block-id ancestor', () => {
    const orphan = document.createElement('p')
    orphan.textContent = 'no block wrapper here'
    document.body.appendChild(orphan)
    const range = document.createRange()
    range.selectNodeContents(orphan)

    expect(captureSelectionOffsets(range)).toBeNull()
  })

  it('returns null for a collapsed range', () => {
    const block = makeBlock('some text')
    const range = document.createRange()
    range.setStart(block.firstChild as Text, 3)
    range.collapse(true)

    expect(captureSelectionOffsets(range)).toBeNull()
  })

  it('returns null when start and end fall in different blocks', () => {
    const blockA = makeBlock('first block text')
    const blockB = makeBlock('second block text')
    const range = document.createRange()
    range.setStart(blockA.firstChild as Text, 2)
    range.setEnd(blockB.firstChild as Text, 5)

    expect(captureSelectionOffsets(range)).toBeNull()
  })

  it('resolveBranchHighlightRange returns null when offsets exceed the block text length', () => {
    const block = makeBlock('short')
    // Block text is 5 chars; ask for [10, 20).
    expect(resolveBranchHighlightRange(block, 10, 20)).toBeNull()
  })

  it('resolveBranchHighlightRange rebuilds a precise sub-range, not the whole block', () => {
    const block = makeBlock('alpha beta gamma delta')
    // Select just "beta gamma" — [6, 16).
    const rebuilt = resolveBranchHighlightRange(block, 6, 16)
    expect(rebuilt?.toString()).toBe('beta gamma')
    // Sanity: it is NOT the whole block.
    expect(rebuilt?.toString()).not.toBe(block.textContent)
  })

  it('captures correctly when an endpoint is an Element node (boundary between children)', () => {
    // Markdown-ish DOM: a paragraph followed by a list. A Selection can land
    // its endpoint on the <p> element itself (offset = child index).
    const block = makeBlock('<p>intro text</p><ul><li>item one</li><li>item two</li></ul>')
    const list = block.querySelector('ul')!
    const firstLiText = block.querySelectorAll('li')[0].firstChild as Text

    // Start: element endpoint — before the <ul>'s first child (the first <li>).
    // End: inside the first <li>'s text, after "item".
    const range = document.createRange()
    range.setStart(list, 0)
    range.setEnd(firstLiText, 4)

    const offsets = captureSelectionOffsets(range)
    // "intro text" = 10 chars, so the <ul> boundary is at offset 10;
    // "item" inside the first <li> ends at 14.
    expect(offsets).toEqual({ start: 10, end: 14 })

    const rebuilt = resolveBranchHighlightRange(block, offsets!.start, offsets!.end)
    expect(rebuilt?.toString()).toBe('item')
  })

  it('round-trips a selection that crosses a list-item boundary', () => {
    const block = makeBlock('<ul><li>first item</li><li>second item</li></ul>')
    const fullText = block.textContent ?? '' // "first itemsecond item"
    const start = fullText.indexOf('item')
    const end = fullText.indexOf('second') + 'second'.length

    const li1Text = block.querySelectorAll('li')[0].firstChild as Text
    const li2Text = block.querySelectorAll('li')[1].firstChild as Text
    const range = document.createRange()
    range.setStart(li1Text, 'first '.length)
    range.setEnd(li2Text, 'second'.length)

    const offsets = captureSelectionOffsets(range)
    expect(offsets).toEqual({ start, end })

    const rebuilt = resolveBranchHighlightRange(block, offsets!.start, offsets!.end)
    expect(rebuilt?.toString()).toBe('itemsecond')
  })
})

/**
 * SCOPE: jsdom has no layout or paint engine, so this block guards the
 * DOM-MUTATION CHAIN (spans correctly injected, then fully unwrapped on
 * clear), NOT visual visibility. A green run here does NOT prove the
 * user can see the amber tint — that still requires manual/browser
 * verification in the running app.
 *
 * Test ranges are built via the production `resolveBranchHighlightRange`
 * offset→range resolver, NOT via `window.getSelection()` — jsdom's
 * Selection support is unreliable, and the offset path is what the
 * production `paintSourceHighlight` itself uses.
 */
describe('paintSourceHighlight + clearSourceHighlight (DOM mutation chain)', () => {
  // Branch-id helpers — all assertions read these so the load-bearing
  // data-branch-id attribute is checked alongside text content.
  const A = 'branch-A-id'
  const B = 'branch-B-id'
  const queryByBranch = (root: Element | Document, id: string) =>
    root.querySelectorAll(`span.branch-anchor-highlight[data-branch-id="${id}"]`)

  it('paint wraps a single-text-node selection in one span whose text === the selected passage (with correct data-branch-id + data-hl)', () => {
    const block = makeBlock('Distillation transfers knowledge to a student model.')

    paintSourceHighlight(block, 13, 32, A, 'c1') // "transfers knowledge"

    const spans = block.querySelectorAll('span.branch-anchor-highlight')
    expect(spans).toHaveLength(1)
    expect(spans[0].textContent).toBe('transfers knowledge')
    expect(spans[0].getAttribute('data-branch-id')).toBe(A)
    expect(spans[0].getAttribute('data-hl')).toBe('c1')
  })

  it('paint wraps a multi-node selection in ≥2 spans whose concatenated text === the selected passage (every span tagged)', () => {
    // childNodes: [text "teacher passes ", <strong>knowledge</strong>, text " to student"]
    const block = makeBlock('teacher passes <strong>knowledge</strong> to student')

    paintSourceHighlight(block, 8, 24, B, 'c3') // "passes " + "knowledge" = "passes knowledge"

    const spans = Array.from(block.querySelectorAll('span.branch-anchor-highlight'))
    expect(spans.length).toBeGreaterThanOrEqual(2)
    expect(spans.map((s) => s.textContent).join('')).toBe('passes knowledge')
    // Every span carries the right id + color — not just the first.
    for (const span of spans) {
      expect(span.getAttribute('data-branch-id')).toBe(B)
      expect(span.getAttribute('data-hl')).toBe('c3')
    }
  })

  it('clear(branchId) removes that branch spans (no shells) and restores the source DOM intact + contiguous', () => {
    const block = makeBlock('alpha beta gamma delta')
    const originalText = block.textContent
    paintSourceHighlight(block, 6, 16, A, 'c1') // "beta gamma"
    expect(queryByBranch(block, A).length).toBeGreaterThan(0)

    clearSourceHighlight(A)

    // (a) No remaining branch-anchor spans anywhere — neither full nor empty shells.
    expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
    // (b) Text content byte-for-byte preserved.
    expect(block.textContent).toBe(originalText)
    // (c) The splitText fragments have been merged by `normalize()`:
    //     the single original text node is the only child once again.
    expect(block.childNodes).toHaveLength(1)
    expect(block.firstChild!.nodeType).toBe(Node.TEXT_NODE)
  })

  it('clear(branchId) is idempotent and safe when there is nothing to clear for that id', () => {
    const block = makeBlock('untouched body')
    expect(() => clearSourceHighlight('never-painted')).not.toThrow()
    expect(block.textContent).toBe('untouched body')
    expect(block.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
  })

  it('re-painting the same branchId replaces (paint internally clears that id first), never accumulates', () => {
    const block = makeBlock('alpha beta gamma delta')

    paintSourceHighlight(block, 0, 5, A, 'c1') // A: "alpha"
    paintSourceHighlight(block, 17, 22, A, 'c1') // re-paint A elsewhere → A's old span gone, only new "delta" left

    const aSpans = queryByBranch(block, A)
    expect(aSpans).toHaveLength(1)
    expect(aSpans[0].textContent).toBe('delta')
    // And nothing leaked under any other id.
    expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(1)
  })

  it('repeated paint/clear cycles for one branchId never accumulate and always end at zero', () => {
    const block = makeBlock('alpha beta gamma delta')

    for (let i = 0; i < 5; i++) {
      paintSourceHighlight(block, 6, 16, A, 'c1')
      expect(queryByBranch(block, A).length).toBeGreaterThan(0)
      clearSourceHighlight(A)
      expect(queryByBranch(block, A)).toHaveLength(0)
    }

    // Final DOM matches the original — text intact, children contiguous.
    expect(block.textContent).toBe('alpha beta gamma delta')
    expect(block.childNodes).toHaveLength(1)
  })

  // --- P1-S2a targeted-clear coverage (multi-branch fixtures, even though
  // the production UI still creates at most one branch). The implementation
  // is what's being verified here, not the UI.

  it('disjoint paint(A) + paint(B) coexist; each span set tagged with its own branchId/color; per-branch concat === passage', () => {
    const block = makeBlock('alpha beta gamma delta')

    paintSourceHighlight(block, 0, 5, A, 'c1') // A: "alpha"
    paintSourceHighlight(block, 17, 22, B, 'c2') // B: "delta"

    const aSpans = Array.from(queryByBranch(block, A))
    const bSpans = Array.from(queryByBranch(block, B))
    expect(aSpans.length).toBeGreaterThan(0)
    expect(bSpans.length).toBeGreaterThan(0)
    expect(aSpans.map((s) => s.textContent).join('')).toBe('alpha')
    expect(bSpans.map((s) => s.textContent).join('')).toBe('delta')
    // Colors are kept independent.
    for (const s of aSpans) expect(s.getAttribute('data-hl')).toBe('c1')
    for (const s of bSpans) expect(s.getAttribute('data-hl')).toBe('c2')
  })

  it('clear(A) leaves B fully intact (count + text + attributes); then clear(B) wipes everything and DOM is restored', () => {
    const block = makeBlock('alpha beta gamma delta')

    paintSourceHighlight(block, 0, 5, A, 'c1') // A: "alpha"
    paintSourceHighlight(block, 17, 22, B, 'c2') // B: "delta"

    // Snapshot B's spans BEFORE clearing A.
    const bSpansBefore = Array.from(queryByBranch(block, B))
    const bTextBefore = bSpansBefore.map((s) => s.textContent).join('')
    const bColorsBefore = bSpansBefore.map((s) => s.getAttribute('data-hl'))

    clearSourceHighlight(A)

    // A gone.
    expect(queryByBranch(block, A)).toHaveLength(0)
    // B unchanged — same count, same text, same color attributes.
    const bSpansAfter = Array.from(queryByBranch(block, B))
    expect(bSpansAfter).toHaveLength(bSpansBefore.length)
    expect(bSpansAfter.map((s) => s.textContent).join('')).toBe(bTextBefore)
    expect(bSpansAfter.map((s) => s.getAttribute('data-hl'))).toEqual(bColorsBefore)
    // Total spans now = just B's.
    expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(bSpansAfter.length)

    clearSourceHighlight(B)

    // Both gone.
    expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
    // DOM fully restored.
    expect(block.textContent).toBe('alpha beta gamma delta')
    expect(block.childNodes).toHaveLength(1)
    expect(block.firstChild!.nodeType).toBe(Node.TEXT_NODE)
  })

  it('nested/overlapping selections: clear(A) leaves nested B spans intact (count + text + attributes)', () => {
    // A = [0, 16) "alpha beta gamma"; B = [11, 22) "gamma delta" — overlap on "gamma".
    // Paint A first; paint B second → B's wrap walks Text nodes inside A's span
    // and nests INSIDE it for the overlapping portion, plus a sibling span for
    // the part outside A. The flattened-text-walker is what makes nesting work.
    const block = makeBlock('alpha beta gamma delta epsilon')

    paintSourceHighlight(block, 0, 16, A, 'c1')
    paintSourceHighlight(block, 11, 22, B, 'c2')

    const bSpansBefore = Array.from(queryByBranch(block, B))
    expect(bSpansBefore.length).toBeGreaterThanOrEqual(2) // nested + sibling
    expect(bSpansBefore.map((s) => s.textContent).join('')).toBe('gamma delta')
    for (const s of bSpansBefore) expect(s.getAttribute('data-hl')).toBe('c2')

    clearSourceHighlight(A)

    // A gone.
    expect(queryByBranch(block, A)).toHaveLength(0)
    // B's two spans (the formerly-nested one + the sibling) still present;
    // their text concatenates to the same passage.
    const bSpansAfter = Array.from(queryByBranch(block, B))
    expect(bSpansAfter).toHaveLength(bSpansBefore.length)
    expect(bSpansAfter.map((s) => s.textContent).join('')).toBe('gamma delta')
    for (const s of bSpansAfter) expect(s.getAttribute('data-hl')).toBe('c2')
    // Total spans = just B's (no A residue).
    expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(bSpansAfter.length)
    // Text content of the block stays intact.
    expect(block.textContent).toBe('alpha beta gamma delta epsilon')
  })

  it('repeated paint/clear cycles across two branches: each clear leaves the other intact; both-clear restores DOM', () => {
    const block = makeBlock('alpha beta gamma delta epsilon')

    for (let i = 0; i < 4; i++) {
      paintSourceHighlight(block, 0, 5, A, 'c1') // "alpha"
      paintSourceHighlight(block, 6, 10, B, 'c2') // "beta"

      // Clear A: B intact.
      clearSourceHighlight(A)
      expect(queryByBranch(block, A)).toHaveLength(0)
      expect(queryByBranch(block, B).length).toBeGreaterThan(0)
      expect(
        Array.from(queryByBranch(block, B))
          .map((s) => s.textContent)
          .join('')
      ).toBe('beta')

      // Clear B: both gone.
      clearSourceHighlight(B)
      expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
    }

    // After several cycles the block is byte-for-byte the original.
    expect(block.textContent).toBe('alpha beta gamma delta epsilon')
    expect(block.childNodes).toHaveLength(1)
  })
})
