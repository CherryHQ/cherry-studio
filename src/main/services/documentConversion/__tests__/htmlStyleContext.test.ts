// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type { DocumentBlock, DocumentTextRun } from '../documentModel'
import { extractHtmlDocument } from '../htmlDocument'

afterEach(() => {
  document.body.innerHTML = ''
})

function textRuns(block: DocumentBlock): DocumentTextRun[] {
  return block.type === 'text' || block.type === 'heading' || block.type === 'code' ? (block.runs ?? []) : []
}

describe('HTML style context', () => {
  it('keeps ancestor and inherited styles around an inline image and a nested list', () => {
    // jsdom leaves span display empty, which this extractor treats as structural.
    // Inline display takes the same flush path Chromium uses for span.
    document.body.innerHTML =
      '<style>.scope { color: rgb(0, 128, 0); } .scope li { font-family: Palatino; } .scope span { font-weight: 700; color: red; font-family: Courier; } .scope .note { font-style: italic; font-weight: 400; color: rgb(0, 0, 255); font-family: Georgia; }</style>' +
      '<ul class="scope"><li>Before <span style="display:inline">Parent</span> <img alt="chart" src="chart.png"> <span class="note" style="display:inline">tail</span><ul><li><span style="display:inline">Child</span></li></ul></li></ul>'

    const { blocks } = extractHtmlDocument()

    expect(blocks.map((block) => ('text' in block ? block.text : block.type))).toEqual([
      'Before Parent',
      'chart',
      'tail',
      'Child'
    ])
    expect(
      blocks.map((block) =>
        block.type === 'columns'
          ? { type: block.type }
          : {
              bullet: block.bullet,
              listDepth: block.listDepth,
              source: block.type === 'image' ? block.source : undefined
            }
      )
    ).toEqual([
      { bullet: 1, listDepth: 1, source: undefined },
      { bullet: undefined, listDepth: 1, source: expect.stringContaining('chart.png') },
      { bullet: undefined, listDepth: 1, source: undefined },
      { bullet: 2, listDepth: 2, source: undefined }
    ])

    const [parent, , tail, child] = blocks
    expect(
      textRuns(parent)
        .map((run) => run.text)
        .join('')
    ).toBe('Before Parent ')
    expect(textRuns(parent).filter((run) => run.text.trim())).toMatchObject([
      { text: 'Before ', bold: false, italic: false, color: '008000', font: 'Palatino' },
      { text: 'Parent', bold: true, italic: false, color: 'FF0000', font: 'Courier' }
    ])
    expect(
      textRuns(tail)
        .map((run) => run.text)
        .join('')
    ).toBe(' tail')
    expect(textRuns(tail).filter((run) => run.text.trim())).toMatchObject([
      { text: 'tail', bold: false, italic: true, color: '0000FF', font: 'Georgia' }
    ])
    expect(textRuns(child)).toMatchObject([
      { text: 'Child', bold: true, italic: false, color: 'FF0000', font: 'Courier' }
    ])
  })
})
