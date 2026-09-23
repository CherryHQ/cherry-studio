import type * as PptxRenderer from '@aiden0z/pptx-renderer'
import type { PresentationData, TextIndexEntry } from '@aiden0z/pptx-renderer'
import { buildTextIndex, materializeSlideNodes } from '@aiden0z/pptx-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'

import { slideExcerpt, slideToPptxAnchor } from '../pptxSelectionAnchor'

// Wraps the real implementations so most tests exercise them unmocked; only the group and
// throw-guard tests below override one for a single call.
vi.mock('@aiden0z/pptx-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof PptxRenderer>()
  return {
    ...actual,
    buildTextIndex: vi.fn(actual.buildTextIndex),
    materializeSlideNodes: vi.fn(actual.materializeSlideNodes)
  }
})

function buildSlide(slideIndex: string | null, text: string): HTMLDivElement {
  const slide = document.createElement('div')
  if (slideIndex !== null) slide.setAttribute('data-slide-index', slideIndex)
  slide.textContent = text
  document.body.appendChild(slide)
  return slide
}

const shapeNode = (id: string, paragraphs: string[]) => ({
  id,
  nodeType: 'shape',
  position: { x: 0, y: 0 },
  size: { w: 1, h: 1 },
  textBody: { paragraphs: paragraphs.map((text) => ({ runs: [{ text }] })) }
})

const tableNode = (id: string, rows: string[][]) => ({
  id,
  nodeType: 'table',
  position: { x: 0, y: 0 },
  size: { w: 1, h: 1 },
  rows: rows.map((cells) => ({
    cells: cells.map((text) => ({ textBody: { paragraphs: [{ runs: [{ text }] }] } }))
  }))
})

/** A group keeps its children as raw XML, so the excerpt reads them through `buildTextIndex`. */
const groupNode = (id: string) => ({
  id,
  nodeType: 'group',
  position: { x: 0, y: 0 },
  size: { w: 1, h: 1 },
  childOffset: { x: 0, y: 0 },
  childExtent: { w: 1, h: 1 },
  children: []
})

const indexEntry = (nodeId: string, nodePath: string, text: string, cell?: { row: number; index: number }) =>
  ({
    slideIndex: 0,
    nodeId,
    nodePath,
    nodeType: cell ? 'table' : 'shape',
    textKind: cell ? 'table-cell' : 'shape',
    text,
    rowIndex: cell?.row,
    cellIndex: cell?.index
  }) as unknown as TextIndexEntry

/**
 * The narrowest deck the excerpt walks: pre-materialized slides (so `materializeSlideNodes` skips
 * lazy XML parsing and placeholder inheritance) whose nodes carry only what the walk reads.
 */
function buildPresentation(slides: Array<{ nodes: unknown[] }>): PresentationData {
  return {
    slides: slides.map((slide, index) => ({
      ...slide,
      index: `ppt/slides/slide${index + 1}.xml`,
      slidePath: `ppt/slides/slide${index + 1}.xml`,
      layoutIndex: '',
      rels: new Map(),
      showMasterSp: false,
      nodesMaterialized: true,
      placeholderInheritanceResolved: true
    })),
    layouts: new Map(),
    masters: new Map(),
    slideToLayout: new Map(),
    layoutToMaster: new Map(),
    diagramDrawings: new Map()
  } as unknown as PresentationData
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('slideToPptxAnchor', () => {
  it('anchors a slide to its one-based number', () => {
    const slide = buildSlide('1', 'Roadmap for Q3')

    expect(slideToPptxAnchor(slide)).toEqual({ anchor: { format: 'pptx', slide: 2 } })
  })

  it('resolves a click on a shape to the slide around it', () => {
    const slide = buildSlide('0', '')
    const shape = document.createElement('div')
    shape.textContent = 'Title shape'
    slide.appendChild(shape)

    expect(slideToPptxAnchor(shape)).toEqual({ anchor: { format: 'pptx', slide: 1 } })
  })

  it('returns null outside any slide or for a malformed index', () => {
    expect(slideToPptxAnchor(buildSlide(null, 'chrome around the deck'))).toBeNull()
    expect(slideToPptxAnchor(buildSlide('-1', 'negative'))).toBeNull()
    expect(slideToPptxAnchor(buildSlide('1.5', 'fractional'))).toBeNull()
  })
})

describe('slideExcerpt', () => {
  it('gives one line per paragraph and one line per table row, in office_extract.py order', () => {
    const presentation = buildPresentation([
      { nodes: [shapeNode('cover', ['Cover'])] },
      {
        nodes: [
          shapeNode('title', ['Roadmap']),
          shapeNode('body', ['Q3 goals', 'Q4 goals']),
          tableNode('grid', [
            ['Owner', 'Status'],
            ['Ada', 'Done']
          ])
        ]
      }
    ])

    const excerpt = slideExcerpt(presentation, 2)
    expect(excerpt).toBe('Roadmap\nQ3 goals\nQ4 goals\nOwner | Status\nAda | Done')
    // Picking slide 2 must not pull in slide 1's text (or pay to materialize and index it).
    expect(excerpt).not.toContain('Cover')
    expect(vi.mocked(materializeSlideNodes)).toHaveBeenCalledExactlyOnceWith(presentation, presentation.slides[1])
    expect(vi.mocked(buildTextIndex)).not.toHaveBeenCalled()
  })

  it('reads only the addressed slide and returns empty for one with no text', () => {
    const presentation = buildPresentation([{ nodes: [shapeNode('cover', ['Cover'])] }, { nodes: [] }])

    expect(slideExcerpt(presentation, 1)).toBe('Cover')
    expect(slideExcerpt(presentation, 2)).toBe('')
  })

  it('returns an empty excerpt for an out-of-range slide', () => {
    const presentation = buildPresentation([{ nodes: [shapeNode('cover', ['Cover'])] }])

    expect(slideExcerpt(presentation, 2)).toBe('')
    expect(slideExcerpt(presentation, 0)).toBe('')
  })

  it("keeps a shape's empty paragraph as an empty line, and a whitespace-only one verbatim", () => {
    const presentation = buildPresentation([{ nodes: [shapeNode('body', ['Roadmap', '', 'Q3 goals'])] }])
    const whitespaceOnly = buildPresentation([{ nodes: [shapeNode('body', ['  '])] }])

    expect(slideExcerpt(presentation, 1)).toBe('Roadmap\n\nQ3 goals')
    // The text index drops any entry that trims to empty; python-pptx reports the paragraph as it is.
    expect(slideExcerpt(whitespaceOnly, 1)).toBe('  ')
  })

  it('keeps every table cell, including a trailing empty one and an all-empty row', () => {
    const presentation = buildPresentation([
      {
        nodes: [
          tableNode('grid', [
            ['A', ''],
            ['', ''],
            ['B', 'C']
          ])
        ]
      }
    ])
    const blankMiddleCell = buildPresentation([{ nodes: [tableNode('grid', [['Owner', '', 'Status']])] }])

    expect(slideExcerpt(presentation, 1)).toBe('A | \n | \nB | C')
    expect(slideExcerpt(blankMiddleCell, 1)).toBe('Owner |  | Status')
  })

  it('falls back to the text index for a group, filtered to that group and padded by cell index', () => {
    const presentation = buildPresentation([
      { nodes: [shapeNode('title', ['Roadmap']), groupNode('cluster'), shapeNode('foot', ['Footer'])] }
    ])
    vi.mocked(buildTextIndex).mockReturnValueOnce([
      indexEntry('inner', 'slides/0/nodes/cluster/children/0/inner', 'Inside group'),
      indexEntry('nested', 'slides/0/nodes/cluster/children/1/nested/rows/0/cells/0', 'Left', { row: 0, index: 0 }),
      indexEntry('nested', 'slides/0/nodes/cluster/children/1/nested/rows/0/cells/2', 'Right', { row: 0, index: 2 }),
      indexEntry('title', 'slides/0/nodes/title', 'Roadmap'),
      indexEntry('stamp', 'slides/0/master/nodes/stamp', 'Confidential')
    ])

    // The group's own subtree only, in place: the shapes around it come from the model walk, and the
    // master shape python never reads stays out.
    expect(slideExcerpt(presentation, 1)).toBe('Roadmap\nInside group\nLeft |  | Right\nFooter')
  })

  it('returns an empty excerpt instead of throwing when the slide fails to materialize', () => {
    const presentation = buildPresentation([{ nodes: [shapeNode('cover', ['Cover'])] }])
    const warn = vi.spyOn(loggerService, 'warn').mockImplementation(() => undefined)
    vi.mocked(materializeSlideNodes).mockImplementationOnce(() => {
      throw new Error('malformed slide XML')
    })

    expect(slideExcerpt(presentation, 1)).toBe('')
    expect(warn).toHaveBeenCalledWith(
      'Failed to read PPTX slide text for excerpt',
      expect.objectContaining({ slide: 1, error: 'malformed slide XML' })
    )
    warn.mockRestore()
  })
})
