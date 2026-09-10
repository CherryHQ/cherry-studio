import type * as PptxRenderer from '@aiden0z/pptx-renderer'
import type { PresentationData } from '@aiden0z/pptx-renderer'
import { buildTextIndex } from '@aiden0z/pptx-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { slideExcerpt, slideToPptxAnchor } from '../pptxSelectionAnchor'

// Wraps the real implementation so most tests exercise it unmocked; only the throw-guard test below
// overrides it for a single call.
vi.mock('@aiden0z/pptx-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof PptxRenderer>()
  return { ...actual, buildTextIndex: vi.fn(actual.buildTextIndex) }
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

/**
 * The narrowest deck `buildTextIndex` walks: pre-materialized slides (so it skips lazy XML parsing
 * and placeholder inheritance) whose nodes carry only what the index reads.
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
    // Picking slide 2 must not pull in slide 1's text (or pay to index it).
    expect(excerpt).not.toContain('Cover')
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

  it('pads a blank middle cell instead of collapsing the row by adjacency', () => {
    // buildTextIndex emits no entry at all for a blank cell, so "Owner | | Status" must be rebuilt
    // from cellIndex (0, skipped, 2), not by concatenating whatever entries happen to be adjacent.
    const presentation = buildPresentation([{ nodes: [tableNode('grid', [['Owner', '', 'Status']])] }])

    expect(slideExcerpt(presentation, 1)).toBe('Owner |  | Status')
  })

  it('returns an empty excerpt instead of throwing when buildTextIndex fails on a malformed slide', () => {
    const presentation = buildPresentation([{ nodes: [shapeNode('cover', ['Cover'])] }])
    vi.mocked(buildTextIndex).mockImplementationOnce(() => {
      throw new Error('malformed slide XML')
    })

    expect(slideExcerpt(presentation, 1)).toBe('')
  })
})
