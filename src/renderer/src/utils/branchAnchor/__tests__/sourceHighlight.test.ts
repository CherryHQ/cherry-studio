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
  it('paint wraps a single-text-node selection in one span whose text === the selected passage', () => {
    const block = makeBlock('Distillation transfers knowledge to a student model.')

    paintSourceHighlight(block, 13, 32) // "transfers knowledge"

    const spans = block.querySelectorAll('span.branch-anchor-highlight')
    expect(spans).toHaveLength(1)
    expect(spans[0].textContent).toBe('transfers knowledge')
  })

  it('paint wraps a multi-node selection in ≥2 spans whose concatenated text === the selected passage', () => {
    // childNodes: [text "teacher passes ", <strong>knowledge</strong>, text " to student"]
    const block = makeBlock('teacher passes <strong>knowledge</strong> to student')

    paintSourceHighlight(block, 8, 24) // "passes " + "knowledge" = "passes knowledge"

    const spans = Array.from(block.querySelectorAll('span.branch-anchor-highlight'))
    expect(spans.length).toBeGreaterThanOrEqual(2)
    expect(spans.map((s) => s.textContent).join('')).toBe('passes knowledge')
  })

  it('clear removes all injected spans (no shells) and restores the source DOM intact + contiguous', () => {
    const block = makeBlock('alpha beta gamma delta')
    const originalText = block.textContent
    paintSourceHighlight(block, 6, 16) // "beta gamma"
    expect(block.querySelectorAll('span.branch-anchor-highlight').length).toBeGreaterThan(0)

    clearSourceHighlight()

    // (a) No remaining branch-anchor spans anywhere — neither full nor empty shells.
    expect(document.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
    // (b) Text content byte-for-byte preserved.
    expect(block.textContent).toBe(originalText)
    // (c) The splitText fragments have been merged by `normalize()`:
    //     the single original text node is the only child once again.
    expect(block.childNodes).toHaveLength(1)
    expect(block.firstChild!.nodeType).toBe(Node.TEXT_NODE)
  })

  it('clear is idempotent and safe when there is nothing to clear', () => {
    const block = makeBlock('untouched body')
    expect(() => clearSourceHighlight()).not.toThrow()
    expect(block.textContent).toBe('untouched body')
    expect(block.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
  })

  it('switching anchors (open A then open B) leaves only B-range spans — no accumulation', () => {
    const block = makeBlock('alpha beta gamma delta')

    paintSourceHighlight(block, 0, 5) // A: "alpha"
    paintSourceHighlight(block, 17, 22) // B: "delta" — paint internally clears A first

    const spans = block.querySelectorAll('span.branch-anchor-highlight')
    expect(spans).toHaveLength(1)
    expect(spans[0].textContent).toBe('delta')
  })

  it('repeated open/clear cycles never accumulate spans and always end at zero', () => {
    const block = makeBlock('alpha beta gamma delta')

    for (let i = 0; i < 5; i++) {
      paintSourceHighlight(block, 6, 16)
      expect(block.querySelectorAll('span.branch-anchor-highlight').length).toBeGreaterThan(0)
      clearSourceHighlight()
      expect(block.querySelectorAll('span.branch-anchor-highlight')).toHaveLength(0)
    }

    // Final DOM matches the original — text intact, children contiguous.
    expect(block.textContent).toBe('alpha beta gamma delta')
    expect(block.childNodes).toHaveLength(1)
  })
})
