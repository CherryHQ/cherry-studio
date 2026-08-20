// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { selectionToPptxAnchor } from '../pptxSelectionAnchor'

function selectText(paragraph: HTMLParagraphElement): Selection {
  const selection = window.getSelection()
  if (!selection) throw new Error('window.getSelection() unavailable in jsdom')

  const range = document.createRange()
  range.selectNodeContents(paragraph)
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

describe('selectionToPptxAnchor', () => {
  it('maps a selection inside a slide container to a 1-based slide anchor', () => {
    document.body.innerHTML = '<div data-slide-index="2"><div><p>文字</p></div></div>'
    const paragraph = document.body.querySelector('p') as HTMLParagraphElement
    const selection = selectText(paragraph)

    const result = selectionToPptxAnchor(selection)

    expect(result).toEqual({ anchor: { format: 'pptx', slide: 3 }, excerpt: '文字' })
  })

  it('returns null when the selection falls outside any slide container', () => {
    document.body.innerHTML = '<div><p>toolbar text</p></div>'
    const paragraph = document.body.querySelector('p') as HTMLParagraphElement
    const selection = selectText(paragraph)

    expect(selectionToPptxAnchor(selection)).toBeNull()
  })

  it('returns null for a collapsed selection', () => {
    document.body.innerHTML = '<div data-slide-index="0"><p>文字</p></div>'
    const paragraph = document.body.querySelector('p') as HTMLParagraphElement
    const selection = window.getSelection()
    if (!selection) throw new Error('window.getSelection() unavailable in jsdom')

    const range = document.createRange()
    range.setStart(paragraph, 0)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)

    expect(selectionToPptxAnchor(selection)).toBeNull()
  })

  it('returns null instead of NaN when the slide-index attribute is not a number', () => {
    document.body.innerHTML = '<div data-slide-index="not-a-number"><p>文字</p></div>'
    const paragraph = document.body.querySelector('p') as HTMLParagraphElement
    const selection = selectText(paragraph)

    const result = selectionToPptxAnchor(selection)

    expect(result).toBeNull()
  })

  it('returns null when selection is null', () => {
    expect(selectionToPptxAnchor(null)).toBeNull()
  })
})
