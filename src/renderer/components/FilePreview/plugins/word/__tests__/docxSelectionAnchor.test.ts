import { afterEach, describe, expect, it } from 'vitest'

import { normalizeSelectionText } from '../../../selectionReference'
import { paragraphExcerpt, paragraphToDocxAnchor } from '../docxSelectionAnchor'

/** Mirrors what the patched docx-preview renders for a single paragraph. */
function buildParagraph(
  attributes: { part?: string; index?: string; paraId?: string },
  text: string
): HTMLParagraphElement {
  const paragraph = document.createElement('p')
  if (attributes.part !== undefined) paragraph.setAttribute('data-docx-part', attributes.part)
  if (attributes.index !== undefined) paragraph.setAttribute('data-docx-index', attributes.index)
  if (attributes.paraId !== undefined) paragraph.setAttribute('data-para-id', attributes.paraId)
  paragraph.appendChild(document.createTextNode(text))
  document.body.appendChild(paragraph)
  return paragraph
}

/** Mirrors docx-preview's own run output: every run is a `<span>` wrapping the run's children. */
function buildRun(...nodes: (string | Node)[]): HTMLSpanElement {
  const run = document.createElement('span')
  run.append(...nodes)
  return run
}

/** Mirrors docx-preview's `renderTab`: a `<span>` whose only content is U+2003. */
function buildTab(): HTMLSpanElement {
  const tab = document.createElement('span')
  tab.innerHTML = '&emsp;'
  return tab
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('paragraphToDocxAnchor', () => {
  it('anchors a body paragraph to its ordinal and paraId with the paragraph text as excerpt', () => {
    const paragraph = buildParagraph({ part: 'body', index: '7', paraId: '1A2B3C4D' }, 'body paragraph text')

    expect(paragraphToDocxAnchor(paragraph)).toEqual({
      anchor: { format: 'docx', paragraph: 7, paraId: '1A2B3C4D' },
      excerpt: 'body paragraph text',
      element: paragraph
    })
  })

  it('omits paraId for documents whose producer never wrote w14:paraId', () => {
    const paragraph = buildParagraph({ part: 'body', index: '0' }, 'paragraph without paraId')

    const result = paragraphToDocxAnchor(paragraph)

    expect(result?.anchor).toEqual({ format: 'docx', paragraph: 0 })
    expect(result?.anchor).not.toHaveProperty('paraId')
  })

  it('resolves a click on an inline element to its enclosing body paragraph', () => {
    const paragraph = buildParagraph({ part: 'body', index: '2' }, 'lead ')
    const run = document.createElement('span')
    run.textContent = 'bold run'
    paragraph.appendChild(run)

    expect(paragraphToDocxAnchor(run)).toEqual({
      anchor: { format: 'docx', paragraph: 2 },
      excerpt: 'lead bold run',
      element: paragraph
    })
  })

  it('returns null for header, footer, footnote and comment paragraphs', () => {
    for (const part of ['header', 'footer', 'footnote', 'endnote', 'comment']) {
      expect(paragraphToDocxAnchor(buildParagraph({ part, index: '1' }, `${part} text`))).toBeNull()
    }
  })

  it('returns null for a paragraph inside a table cell', () => {
    // The patch's `parseBodyElements` gives w:tbl its own case, so a table's paragraphs are rendered
    // with neither data-docx-part nor data-docx-index — they carry no body ordinal to anchor to.
    const cell = document.createElement('td')
    const paragraph = document.createElement('p')
    paragraph.textContent = 'cell text'
    cell.appendChild(paragraph)
    document.body.appendChild(cell)

    expect(paragraphToDocxAnchor(paragraph)).toBeNull()
  })

  it('returns null for a paragraph the docx-preview patch left unnumbered', () => {
    expect(paragraphToDocxAnchor(buildParagraph({ part: 'body' }, 'text box paragraph'))).toBeNull()
    expect(paragraphToDocxAnchor(buildParagraph({ part: 'body', index: '-1' }, 'negative ordinal'))).toBeNull()
    expect(paragraphToDocxAnchor(buildParagraph({ part: 'body', index: '2.5' }, 'fractional ordinal'))).toBeNull()
  })

  it('anchors an unnumbered text-box paragraph to nothing rather than to the body paragraph around it', () => {
    // docx-preview parses w:txbxContent without a part, so the inner paragraph has no ordinal while the
    // outer one does. A pick inside the text box must not silently address the outer paragraph.
    const outer = buildParagraph({ part: 'body', index: '4' }, 'outer ')
    const inner = document.createElement('p')
    inner.textContent = 'inside the text box'
    outer.appendChild(inner)

    expect(paragraphToDocxAnchor(inner)).toBeNull()
  })

  it('excerpts a line break as the newline python-docx emits rather than as nothing', () => {
    const paragraph = buildParagraph({ part: 'body', index: '3' }, '')
    paragraph.appendChild(buildRun('Alpha', document.createElement('br'), 'Beta'))

    expect(paragraphToDocxAnchor(paragraph)?.excerpt).toBe('Alpha\nBeta')
  })

  it('returns null when the element is not inside any paragraph', () => {
    const div = document.createElement('div')
    div.textContent = 'chrome'
    document.body.appendChild(div)

    expect(paragraphToDocxAnchor(div)).toBeNull()
  })
})

describe('paragraphExcerpt', () => {
  it('spells w:noBreakHyphen as the hyphen python-docx emits', () => {
    const paragraph = document.createElement('p')
    paragraph.appendChild(buildRun('Alpha', document.createElement('wbr'), 'Beta'))

    expect(paragraphExcerpt(paragraph)).toBe('Alpha-Beta')
  })

  it('keeps the U+2003 docx-preview renders w:tab as, which normalization collapses like the python tab', () => {
    const paragraph = document.createElement('p')
    paragraph.append(buildRun('Alpha'), buildRun(buildTab()), buildRun('Beta'))

    expect(paragraphExcerpt(paragraph)).toBe('Alpha\u2003Beta')
    expect(normalizeSelectionText(paragraphExcerpt(paragraph))).toBe(normalizeSelectionText('Alpha\tBeta'))
  })

  it('walks nested inline elements in document order', () => {
    const paragraph = document.createElement('p')
    const emphasis = document.createElement('em')
    emphasis.append('nested', document.createElement('br'), 'deeper')
    paragraph.appendChild(buildRun('lead ', emphasis, ' tail'))

    expect(paragraphExcerpt(paragraph)).toBe('lead nested\ndeeper tail')
  })
})
