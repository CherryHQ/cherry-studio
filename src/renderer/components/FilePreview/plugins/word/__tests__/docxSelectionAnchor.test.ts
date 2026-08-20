import { afterEach, describe, expect, it } from 'vitest'

import { selectionToDocxAnchor } from '../docxSelectionAnchor'

/** Mirrors what the patched docx-preview renders for a single paragraph. */
function buildParagraph(
  attributes: { part?: string; index?: string; paraId?: string },
  text: string
): { paragraph: HTMLParagraphElement; textNode: Text } {
  const paragraph = document.createElement('p')
  if (attributes.part !== undefined) paragraph.setAttribute('data-docx-part', attributes.part)
  if (attributes.index !== undefined) paragraph.setAttribute('data-docx-index', attributes.index)
  if (attributes.paraId !== undefined) paragraph.setAttribute('data-para-id', attributes.paraId)
  const textNode = document.createTextNode(text)
  paragraph.appendChild(textNode)
  document.body.appendChild(paragraph)
  return { paragraph, textNode }
}

function selectionOver(range: Range, isCollapsed = false): Selection {
  return {
    isCollapsed,
    rangeCount: 1,
    getRangeAt: () => range
  } as unknown as Selection
}

function rangeOver(textNode: Text, length = textNode.length): Range {
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, length)
  return range
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('selectionToDocxAnchor', () => {
  it('anchors a body paragraph to its ordinal and paraId', () => {
    const { textNode } = buildParagraph({ part: 'body', index: '7', paraId: '1A2B3C4D' }, 'body paragraph text')

    const result = selectionToDocxAnchor(selectionOver(rangeOver(textNode)))

    expect(result?.anchor).toEqual({ format: 'docx', paragraph: 7, paraId: '1A2B3C4D' })
    expect(result?.excerpt).toBe('body paragraph text')
  })

  it('omits paraId for documents whose producer never wrote w14:paraId', () => {
    const { textNode } = buildParagraph({ part: 'body', index: '0' }, 'paragraph without paraId')

    const result = selectionToDocxAnchor(selectionOver(rangeOver(textNode)))

    expect(result?.anchor).toEqual({ format: 'docx', paragraph: 0 })
    expect(result?.anchor).not.toHaveProperty('paraId')
  })

  it.each(['header', 'footer', 'footnote', 'endnote', 'comment'])(
    'returns null for a selection inside a %s paragraph, whose ordinal is not a body ordinal',
    (part) => {
      const { textNode } = buildParagraph({ part, index: '0', paraId: 'FFFF0001' }, `${part} text`)

      expect(selectionToDocxAnchor(selectionOver(rangeOver(textNode)))).toBeNull()
    }
  )

  it('returns null inside a table paragraph, which the patch leaves unnumbered', () => {
    const cell = document.createElement('td')
    const paragraph = document.createElement('p')
    paragraph.setAttribute('data-para-id', 'CCCC0003')
    const textNode = document.createTextNode('cell text')
    paragraph.appendChild(textNode)
    cell.appendChild(paragraph)
    document.body.appendChild(cell)

    expect(selectionToDocxAnchor(selectionOver(rangeOver(textNode)))).toBeNull()
  })

  it('returns null for a collapsed selection', () => {
    const { textNode } = buildParagraph({ part: 'body', index: '3' }, 'body paragraph text')
    const range = document.createRange()
    range.setStart(textNode, 2)
    range.setEnd(textNode, 2)

    expect(selectionToDocxAnchor(selectionOver(range, true))).toBeNull()
  })

  it('returns null when the selection starts outside any rendered paragraph', () => {
    const outside = document.createTextNode('chrome around the document')
    document.body.appendChild(outside)

    expect(selectionToDocxAnchor(selectionOver(rangeOver(outside)))).toBeNull()
  })

  it('anchors a cross-paragraph selection to its starting paragraph while keeping the full excerpt', () => {
    const first = buildParagraph({ part: 'body', index: '4', paraId: 'AAAA0001' }, 'first paragraph')
    const second = buildParagraph({ part: 'body', index: '5', paraId: 'BBBB0002' }, 'second paragraph')

    const range = document.createRange()
    range.setStart(first.textNode, 0)
    range.setEnd(second.textNode, second.textNode.length)

    const result = selectionToDocxAnchor(selectionOver(range))

    expect(result?.anchor).toEqual({ format: 'docx', paragraph: 4, paraId: 'AAAA0001' })
    expect(result?.excerpt).toContain('second paragraph')
  })
})
