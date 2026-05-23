import { afterEach, describe, expect, it } from 'vitest'

import { captureSelectionOffsets, resolveBranchHighlightRange } from '../sourceHighlight'

/**
 * T-006D-2B S6' precise-range highlight — capture ↔ rebuild round-trip.
 *
 * The two halves must agree: offsets captured from a real Range must rebuild
 * to a Range covering the same text. jsdom supports Range + TreeWalker, so
 * the algorithm is verifiable here; the CSS Custom Highlight paint itself
 * (`CSS.highlights`) is browser-only and not unit-tested.
 */

afterEach(() => {
  document.body.innerHTML = ''
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
