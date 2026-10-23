import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { extractDocumentParts, materializeDocumentImages } from '../extractDocumentParts'
import { docx, paragraph, picture, png, relationshipsXml } from './docxFixtures'

const { version, read, cacheSet, cache } = vi.hoisted(() => ({
  version: vi.fn(),
  read: vi.fn(),
  cacheSet: vi.fn(),
  cache: new Map<string, unknown>()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: { getVersion: version, read },
    CacheService: { get: (key: string) => cache.get(key), set: cacheSet }
  })
})
const source = { entryId: 'entry', mtime: 1, size: 2 }
const key = 'doc-extraction:entry:1:2:parts:v1'
beforeEach(() => {
  vi.clearAllMocks()
  cache.clear()
  version.mockResolvedValue({ mtime: 1, size: 2 })
  cacheSet.mockImplementation((key: string, value: unknown) => cache.set(key, structuredClone(value)))
})

describe('versioned DOCX discovery and selected image reads', () => {
  it('keeps metadata separate from the canonical text cache with a 30 minute TTL and no image bytes', async () => {
    const bytes = await png()
    read.mockResolvedValue({ content: await docx(paragraph(picture()), { 'word/media/a.png': bytes }) })
    cache.set('doc-extraction:entry:1:2', 'canonical')
    const first = await extractDocumentParts(source, 'canonical')
    await materializeDocumentImages(first, [0])
    const metadata = cache.get(key)
    expect(cache.get('doc-extraction:entry:1:2')).toBe('canonical')
    expect(metadata).toMatchObject({
      canonicalTextSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      images: [{ sha256: expect.any(String), width: 128, height: 128 }]
    })
    expect(metadata).not.toHaveProperty('text')
    expect(JSON.stringify(metadata)).not.toMatch(/base64|data:image|"bytes"|"content"/u)
    expect(cacheSet.mock.calls.every((call) => call[2] === 1_800_000)).toBe(true)
    read.mockRejectedValue(new Error('cache must avoid read'))
    expect(await extractDocumentParts(source, 'canonical')).toMatchObject({
      text: 'canonical',
      imageCount: { total: 1 }
    })
  })
  it('does not pair cached spans with changed canonical text', async () => {
    read.mockResolvedValue({ content: await docx(paragraph(picture())) })
    await extractDocumentParts(source, 'old')
    const next = await extractDocumentParts(source, 'new canonical')
    expect(next.text).toBe('new canonical')
    expect(next.parts[0]).toEqual({ kind: 'text', start: 0, end: 13 })
  })
  it('counts source-changed when the source changed before discovery and never caches stale spans', async () => {
    version.mockResolvedValue({ mtime: 9, size: 2 })
    read.mockResolvedValue({ content: await docx(paragraph(picture())) })
    const result = await extractDocumentParts(source, 'old')
    expect(result.images).toEqual([{ index: 0, target: 'word/media/a.png', omission: 'source-changed' }])
    expect(cache.size).toBe(0)
  })
  it('propagates aborts during reads and leaves no successful metadata cache', async () => {
    const controller = new AbortController()
    read.mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      return { content: await docx('') }
    })
    await expect(extractDocumentParts(source, '', controller.signal)).rejects.toThrow('cancelled')
    expect(cache.size).toBe(0)
  })
  it('normalizes only selected occurrences and keeps original-byte duplicate representatives', async () => {
    read.mockResolvedValue({
      content: await docx(
        paragraph(picture() + picture('r2') + picture('r3')),
        { 'word/media/a.png': await png(), 'word/media/b.png': await png(256, 128, '#0000ff') },
        relationshipsXml(
          '<Relationship Id="r1" Target="media/a.png"/><Relationship Id="r2" Target="media/a.png"/><Relationship Id="r3" Target="media/b.png"/>'
        )
      )
    })
    const document = await extractDocumentParts(source, '')
    const results = await materializeDocumentImages(document, [1, 2])
    expect(results[0]).toEqual({ occurrenceIndex: 1, kind: 'omitted', reason: 'duplicate' })
    expect(results[1]).toMatchObject({ occurrenceIndex: 2, kind: 'image', width: 256, height: 128 })
    expect(results).toHaveLength(2)
  })
  it('rejects bytes if the source changes before or after image materialization', async () => {
    read.mockResolvedValue({ content: await docx(paragraph(picture()), { 'word/media/a.png': await png() }) })
    const document = await extractDocumentParts(source, '')
    version.mockResolvedValueOnce(source).mockResolvedValueOnce({ mtime: 2, size: 2 })
    expect(await materializeDocumentImages(document, [0])).toEqual([
      { occurrenceIndex: 0, kind: 'omitted', reason: 'source-changed' }
    ])
    version.mockResolvedValue({ mtime: 2, size: 2 })
    expect(await materializeDocumentImages(document, [0])).toEqual([
      { occurrenceIndex: 0, kind: 'omitted', reason: 'source-changed' }
    ])
  })
  it('inspects metadata without raster output for an empty selection and rejects oversized expansion', async () => {
    read.mockResolvedValue({
      content: await docx(
        paragraph(picture() + picture('r2')),
        { 'word/media/a.png': await png(), 'word/media/large.png': new Uint8Array(16_000_001) },
        relationshipsXml('<Relationship Id="r1" Target="media/a.png"/><Relationship Id="r2" Target="media/large.png"/>')
      )
    })
    const document = await extractDocumentParts(source, '')
    expect(await materializeDocumentImages(document, [])).toEqual([])
    expect(document.images).toEqual([
      expect.objectContaining({ index: 0, sha256: expect.any(String), width: 128, height: 128 }),
      { index: 1, target: 'word/media/large.png', omission: 'image-byte-limit' }
    ])
    expect(JSON.stringify(cache.get(key))).not.toContain('"bytes"')
  })
  it('keeps the first original-byte representative even when it is too small to deliver', async () => {
    read.mockResolvedValue({
      content: await docx(paragraph(picture() + picture()), { 'word/media/a.png': await png(127, 1000) })
    })
    const document = await extractDocumentParts(source, '')
    expect(await materializeDocumentImages(document, [0, 1])).toEqual([
      { occurrenceIndex: 0, kind: 'omitted', reason: 'too-small' },
      { occurrenceIndex: 1, kind: 'omitted', reason: 'duplicate' }
    ])
    expect(document.images[1].duplicateOf).toBe(0)
  })
  it('reports unreadable containers and missing data without caching transient read failures', async () => {
    read.mockRejectedValue(new Error('temporary read failure'))
    expect(await extractDocumentParts(source, '')).toMatchObject({
      imageCount: { total: null, known: 0 },
      discoveryFailure: 'unreadable-container'
    })
    expect(cache.size).toBe(0)
    read.mockResolvedValue({ content: await docx(paragraph(picture())) })
    const document = await extractDocumentParts(source, '')
    expect(await materializeDocumentImages(document, [0])).toEqual([
      { occurrenceIndex: 0, kind: 'omitted', reason: 'missing-image' }
    ])
    expect(application.get('CacheService').get(key)).toBeDefined()
  })
})
