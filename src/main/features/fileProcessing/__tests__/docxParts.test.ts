import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { parseDocxParts } from '../docxParts'
import { documentXml, docx, paragraph, picture, png, relationshipsXml, runText } from './docxFixtures'

async function fixture(body: string, text: string | null) {
  const zip = await JSZip.loadAsync(
    await docx(body, { 'word/media/a.png': await png(), 'word/media/unused.png': await png(256) })
  )
  return parseDocxParts(
    await zip.file('word/document.xml')!.async('string'),
    await zip.file('word/_rels/document.xml.rels')!.async('string'),
    text
  )
}

describe('DOCX body discovery and canonical alignment', () => {
  it('keeps an image between paragraphs without emitting unused archive images', async () => {
    const result = await fixture(
      paragraph(runText('Before')) + paragraph(picture()) + paragraph(runText('After')),
      'Before\nAfter'
    )
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 6 },
      { kind: 'image', occurrenceIndex: 0 },
      { kind: 'text', start: 6, end: 12 }
    ])
    expect(result.images).toEqual([{ index: 0, target: 'word/media/a.png' }])
    expect(result.imageCount).toEqual({ total: 1, known: 1 })
  })
  it('does not move an image past the text following it in the same paragraph', async () => {
    const result = await fixture(paragraph(runText('Before') + picture() + runText('After')), 'BeforeAfter')
    expect(result.order).toBe('interleaved')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 6 },
      { kind: 'image', occurrenceIndex: 0 },
      { kind: 'text', start: 6, end: 11 }
    ])
  })
  it('finds table-cell and image-only paragraphs and counts repeated references as occurrences', async () => {
    const result = await fixture(
      `<w:tbl><w:tr><w:tc>${paragraph(picture())}</w:tc></w:tr></w:tbl>${paragraph(picture())}`,
      ''
    )
    expect(result.parts).toEqual([
      { kind: 'image', occurrenceIndex: 0 },
      { kind: 'image', occurrenceIndex: 1 }
    ])
    expect(result.imageCount.total).toBe(2)
  })
  it('does not depend on namespace prefix spellings or count a compatibility fallback twice', () => {
    const body = paragraph(
      `<mc:AlternateContent><mc:Choice Requires="a">${picture()}</mc:Choice><mc:Fallback>${picture()}</mc:Fallback></mc:AlternateContent>`
    )
    const original = documentXml(body)
    const renamed = original
      .replaceAll('w:', 'word:')
      .replaceAll('xmlns:w=', 'xmlns:word=')
      .replaceAll('a:', 'draw:')
      .replaceAll('xmlns:a=', 'xmlns:draw=')
      .replaceAll('r:', 'rel:')
      .replaceAll('xmlns:r=', 'xmlns:rel=')
    const expected = parseDocxParts(original, relationshipsXml(), '')
    expect(parseDocxParts(renamed, relationshipsXml(), '')).toEqual(expected)
    expect(expected.imageCount.total).toBe(1)
  })
  it.each([
    '',
    '<Relationship Id="r1" Target="https://example.com/a.png" TargetMode="External"/>',
    '<Relationship Id="r1" Target="../../a.png"/>',
    '<Relationship Id="r1" Target="//../a.png"/>',
    '<NotRelationship Id="r1" Target="media/a.png"/>',
    '<Relationship Id="r1" Target="%2e%2e/%2e%2e/a.png"/>'
  ])('counts broken or unsafe relationships instead of silently losing images (%s)', (rels) => {
    const result = parseDocxParts(documentXml(paragraph(picture())), relationshipsXml(rels), '')
    expect(result.images).toEqual([{ index: 0, omission: 'broken-relationship' }])
    expect(result.imageCount.total).toBe(1)
  })
  it('aligns repeated paragraphs sequentially and preserves canonical whitespace exactly', async () => {
    const text = 'same  text\n\nsame text'
    const result = await fixture(paragraph(runText('same text')) + paragraph(picture() + runText('same text')), text)
    expect(result.order).toBe('interleaved')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 12 },
      { kind: 'image', occurrenceIndex: 0 },
      { kind: 'text', start: 12, end: text.length }
    ])
  })
  it.each(['different', 'same\nsame', null])(
    'falls back rather than searching for a matching repeated substring (%s)',
    async (text) => {
      const result = await fixture(paragraph(runText('same') + picture()), text)
      expect(result.order).toBe('text-first')
      expect(result.text).toBe(text)
      expect(result.parts.at(-1)).toEqual({ kind: 'image', occurrenceIndex: 0 })
    }
  )
  it('falls back when a whitespace boundary has more than one canonical offset', async () => {
    const result = await fixture(paragraph(runText('a ') + picture() + runText(' b')), 'a  b')
    expect(result.order).toBe('text-first')
  })
  it('preserves a no-image DOCX as a single canonical text span', async () => {
    const result = await fixture(paragraph(runText('Only text')), 'Only text')
    expect(result.parts).toEqual([{ kind: 'text', start: 0, end: 9 }])
    expect(result.imageCount.total).toBe(0)
  })
  it('reports an unknown count for unreadable document XML instead of claiming zero images', () => {
    expect(parseDocxParts('<w:document>', null, 'good text')).toMatchObject({
      text: 'good text',
      imageCount: { total: null, known: 0 },
      discoveryFailure: 'unreadable-document-xml'
    })
  })
})
