import { describe, expect, it } from 'vitest'

import { selectionToPdfAnchor } from '../pdfSelectionAnchor'

function buildPage(pageNumber: number, text: string): { page: HTMLDivElement; textNode: Text } {
  const page = document.createElement('div')
  page.setAttribute('data-page-number', String(pageNumber))
  const textNode = document.createTextNode(text)
  page.appendChild(textNode)
  document.body.appendChild(page)
  return { page, textNode }
}

function fakeSelection(range: Range, isCollapsed = false): Selection {
  return {
    isCollapsed,
    rangeCount: 1,
    getRangeAt: () => range
  } as unknown as Selection
}

describe('selectionToPdfAnchor', () => {
  it('anchors to the start page and excludes text from the next page when a selection spans two pages', () => {
    const page1 = buildPage(1, 'first page text')
    const page2 = buildPage(2, 'second page text')

    const range = document.createRange()
    range.setStart(page1.textNode, 0)
    range.setEnd(page2.textNode, 'second page'.length)

    const result = selectionToPdfAnchor(fakeSelection(range))

    expect(result?.anchor).toEqual({ format: 'pdf', page: 1 })
    // Asserted as an exact value: the range ends partway into page 2, so `not.toContain('second page text')`
    // would hold even without the clip — it looks for a string the selection never covered.
    expect(result?.excerpt).toBe('first page text')
  })

  it('returns null when the clip leaves nothing, instead of quoting an empty excerpt', () => {
    // Starting at the very end of page 1 and running into page 2: the clip to the end of page 1
    // covers no text at all, so there is nothing to quote.
    const page1 = buildPage(1, 'first page text')
    const page2 = buildPage(2, 'second page text')

    const range = document.createRange()
    range.setStart(page1.textNode, page1.textNode.length)
    range.setEnd(page2.textNode, page2.textNode.length)

    expect(selectionToPdfAnchor(fakeSelection(range))).toBeNull()
  })

  it('returns null for a collapsed selection', () => {
    const { textNode } = buildPage(1, 'only page text')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 0)

    const result = selectionToPdfAnchor(fakeSelection(range, true))

    expect(result).toBeNull()
  })

  it('does not throw and resolves the page number when startContainer is a Text node', () => {
    const { textNode } = buildPage(3, 'single page text')
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 'single page'.length)

    expect(textNode.nodeType).toBe(Node.TEXT_NODE)
    const result = selectionToPdfAnchor(fakeSelection(range))

    expect(result?.anchor).toEqual({ format: 'pdf', page: 3 })
  })

  it('returns null when the selection is not inside a rendered page', () => {
    const outside = document.createTextNode('outside any page')
    document.body.appendChild(outside)
    const range = document.createRange()
    range.setStart(outside, 0)
    range.setEnd(outside, 'outside'.length)

    const result = selectionToPdfAnchor(fakeSelection(range))

    expect(result).toBeNull()
  })
})
