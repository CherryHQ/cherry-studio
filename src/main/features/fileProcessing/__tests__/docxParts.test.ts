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
  it('interleaves 40 boundaries on one 16,000-character line', () => {
    const text = 'x'.repeat(16_000)
    const result = parseDocxParts(
      documentXml(paragraph((runText('x'.repeat(400)) + picture()).repeat(40))),
      relationshipsXml(),
      text
    )
    expect(result.order).toBe('interleaved')
    expect(result.imageCount).toEqual({ total: 40, known: 40 })
    expect(result.images).toEqual(Array.from({ length: 40 }, (_, index) => ({ index, target: 'word/media/a.png' })))
    expect(result.parts).toEqual(
      Array.from({ length: 40 }, (_, index) => [
        { kind: 'text', start: index * 400, end: (index + 1) * 400 },
        { kind: 'image', occurrenceIndex: index }
      ]).flat()
    )
    expect(
      result.parts.flatMap((part) => (part.kind === 'text' ? [text.slice(part.start, part.end)] : [])).join('')
    ).toBe(text)
  })
  it('admits exactly 2,000,000 alignment units and retains all 999 boundaries', () => {
    const result = parseDocxParts(
      documentXml(paragraph((runText('x') + picture()).repeat(999))),
      relationshipsXml(),
      'x'.repeat(999)
    )
    expect(result.order).toBe('interleaved')
    expect(result.imageCount).toEqual({ total: 999, known: 999 })
    expect(result.images).toEqual(Array.from({ length: 999 }, (_, index) => ({ index, target: 'word/media/a.png' })))
    expect(result.parts).toEqual(
      Array.from({ length: 999 }, (_, index) => [
        { kind: 'text', start: index, end: index + 1 },
        { kind: 'image', occurrenceIndex: index }
      ]).flat()
    )
  })
  it('falls back above the limit without losing unresolved or later table occurrences', () => {
    const body = paragraph((runText('x') + picture()).repeat(999) + picture('missing'))
    const text = 'x'.repeat(999)
    const result = parseDocxParts(documentXml(body), relationshipsXml(), text)
    expect(result.order).toBe('text-first')
    expect(result.text).toBe(text)
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 999 },
      ...Array.from({ length: 1000 }, (_, occurrenceIndex) => ({ kind: 'image', occurrenceIndex }))
    ])
    expect(result.images).toHaveLength(1000)
    expect(result.imageCount).toEqual({ total: 1000, known: 1000 })
    expect(result.discoveryFailure).toBeUndefined()
    expect(result.images[999]).toEqual({ index: 999, omission: 'broken-relationship' })
    const later = parseDocxParts(
      documentXml(body + `<w:tbl><w:tr><w:tc>${paragraph(picture())}</w:tc></w:tr></w:tbl>`),
      relationshipsXml(),
      text
    )
    expect(later.order).toBe('text-first')
    expect(later.images).toEqual([...result.images, { index: 1000, target: 'word/media/a.png' }])
    expect(later.parts).toEqual([...result.parts, { kind: 'image', occurrenceIndex: 1000 }])
    expect(later.imageCount).toEqual({ total: 1001, known: 1001 })
    expect(later.discoveryFailure).toBeUndefined()
  })
  it.each(['xml whitespace', 'empty paragraph'])('charges %s independently of canonical length', (extra) => {
    const runs = (runText('x') + picture()).repeat(999)
    const body = extra === 'xml whitespace' ? paragraph(runText(' ') + runs) : paragraph(runs) + paragraph('')
    const result = parseDocxParts(documentXml(body), relationshipsXml(), 'x'.repeat(999))
    expect(result.order).toBe('text-first')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 999 },
      ...Array.from({ length: 999 }, (_, occurrenceIndex) => ({ kind: 'image', occurrenceIndex }))
    ])
    expect(result.imageCount).toEqual({ total: 999, known: 999 })
  })
  it.each([
    ['ab', 'ab'],
    [' ab', 'ab'],
    ['ab ', 'ab'],
    ['a b', 'a b'],
    ['a   b', 'a b'],
    ['a b', 'a   b'],
    ['a\tb', 'a b'],
    ['a\u00a0b', 'a b'],
    ['\ufeffab', 'ab'],
    ['a\ufeffb', 'a b'],
    ['a\u200bb', 'a\u200bb'],
    ['a😀b', 'a😀b'],
    ['a   bc', 'a bc'],
    ['ab   c', 'ab c'],
    ['a  bc', 'a\tbc']
  ])('matches the two-sided slice oracle for canonical %j and XML %j', (canonical, xml) => {
    const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim()
    for (let boundary = 0; boundary <= xml.length; boundary++) {
      if (boundary > 0 && /[\uD800-\uDBFF]/u.test(xml[boundary - 1]) && /[\uDC00-\uDFFF]/u.test(xml[boundary] ?? ''))
        continue
      const prefix = xml.slice(0, boundary)
      const suffix = xml.slice(boundary)
      const candidates = Array.from({ length: canonical.length + 1 }, (_, offset) => offset).filter(
        (offset) =>
          normalize(canonical.slice(0, offset)) === normalize(prefix) &&
          normalize(canonical.slice(offset)) === normalize(suffix)
      )
      const result = parseDocxParts(
        documentXml(paragraph(runText(prefix) + picture() + runText(suffix))),
        relationshipsXml(),
        canonical
      )
      if (candidates.length === 1) {
        const offset = candidates[0]
        expect(result.order).toBe('interleaved')
        expect(result.parts).toEqual([
          ...(offset ? [{ kind: 'text', start: 0, end: offset }] : []),
          { kind: 'image', occurrenceIndex: 0 },
          ...(offset < canonical.length ? [{ kind: 'text', start: offset, end: canonical.length }] : [])
        ])
      } else {
        expect(result.order).toBe('text-first')
        expect(result.parts).toEqual([
          { kind: 'text', start: 0, end: canonical.length },
          { kind: 'image', occurrenceIndex: 0 }
        ])
      }
    }
  })
  it('keeps equal boundaries and canonical CRLF separators around breaks', () => {
    const result = parseDocxParts(
      documentXml(paragraph(runText('a') + picture() + picture() + '<w:r><w:br/></w:r>' + picture() + runText('b'))),
      relationshipsXml(),
      'a\r\nb'
    )
    expect(result.order).toBe('interleaved')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 1 },
      { kind: 'image', occurrenceIndex: 0 },
      { kind: 'image', occurrenceIndex: 1 },
      { kind: 'text', start: 1, end: 3 },
      { kind: 'image', occurrenceIndex: 2 },
      { kind: 'text', start: 3, end: 4 }
    ])
  })
  it.each([
    paragraph(runText('a') + '<w:r><w:br/></w:r>' + picture() + '<w:r><w:br/></w:r>' + runText('b')),
    paragraph(runText('a')) + paragraph(runText(' ') + picture()) + paragraph(runText('b'))
  ])('falls back for images on empty-normalized lines of nonempty paragraphs (%s)', (body) => {
    const result = parseDocxParts(documentXml(body), relationshipsXml(), 'a\nb')
    expect(result.order).toBe('text-first')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 3 },
      { kind: 'image', occurrenceIndex: 0 }
    ])
  })
  it('pairs nonempty lines across blank XML lines', () => {
    const result = parseDocxParts(
      documentXml(paragraph(runText('a') + '<w:r><w:br/><w:br/></w:r>' + runText('b') + picture())),
      relationshipsXml(),
      'a\n\nb'
    )
    expect(result.order).toBe('interleaved')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: 4 },
      { kind: 'image', occurrenceIndex: 0 }
    ])
  })
  it.each([
    [runText('a') + picture() + runText('\r\nb'), 1],
    [runText('a\r\n') + picture() + runText('b'), 3]
  ])('preserves boundaries before and after literal XML CRLF (%s)', (runs, offset) => {
    const result = parseDocxParts(documentXml(paragraph(runs)), relationshipsXml(), 'a\r\nb')
    expect(result.order).toBe('interleaved')
    expect(result.parts).toEqual([
      { kind: 'text', start: 0, end: offset },
      { kind: 'image', occurrenceIndex: 0 },
      { kind: 'text', start: offset, end: 4 }
    ])
  })
})
