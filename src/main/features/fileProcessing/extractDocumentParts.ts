import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import JSZip from 'jszip'

import { application } from '@application'

import { inspectDocumentImage, normalizeDocumentImage } from './documentImage'
import { parseDocxParts } from './docxParts'
import type { DocumentParts, DocumentSource, MaterializedDocumentImage } from './types'

type CachedParts = Omit<DocumentParts, 'text'> & { canonicalTextSha256: string | null }
const hash = (text: string | null) => (text === null ? null : createHash('sha256').update(text).digest('hex'))
const keyOf = (source: DocumentSource) => `doc-extraction:${source.entryId}:${source.mtime}:${source.size}:parts:v1`
const TTL = 1_800_000

async function sameVersion(source: DocumentSource): Promise<boolean> {
  const version = await application.get('FileManager').getVersion(source.entryId)
  return version.mtime === source.mtime && version.size === source.size
}

function cacheParts(document: DocumentParts): void {
  const { text, ...metadata } = document
  application
    .get('CacheService')
    .set(keyOf(document.source), structuredClone({ ...metadata, canonicalTextSha256: hash(text) }), TTL)
}

async function readArchive(source: DocumentSource, signal?: AbortSignal): Promise<JSZip> {
  signal?.throwIfAborted()
  const { content } = await application.get('FileManager').read(source.entryId, { encoding: 'binary' })
  signal?.throwIfAborted()
  return JSZip.loadAsync(content)
}

export async function extractDocumentParts(
  source: DocumentSource,
  canonicalText: string | null,
  signal?: AbortSignal
): Promise<DocumentParts> {
  signal?.throwIfAborted()
  const current = await sameVersion(source)
  const cached = application.get('CacheService').get<CachedParts>(keyOf(source))
  if (current && cached) {
    const { canonicalTextSha256, ...metadata } = cached
    if (canonicalTextSha256 === hash(canonicalText) && (await sameVersion(source))) {
      signal?.throwIfAborted()
      return structuredClone({ ...metadata, text: canonicalText })
    }
  }
  let zip: JSZip
  try {
    zip = await readArchive(source, signal)
  } catch {
    signal?.throwIfAborted()
    return {
      source,
      text: canonicalText,
      order: 'text-first',
      parts: canonicalText ? [{ kind: 'text', start: 0, end: canonicalText.length }] : [],
      images: [],
      imageCount: { total: null, known: 0 },
      discoveryFailure: 'unreadable-container'
    }
  }
  let xml: string
  try {
    const member = zip.file('word/document.xml')
    if (!member) throw new Error('Missing document')
    xml = await member.async('string')
  } catch {
    signal?.throwIfAborted()
    return { source, ...parseDocxParts('', null, canonicalText) }
  }
  let relationships: string | null = null
  try {
    relationships = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? null
  } catch {
    /* References remain counted even without readable relationships. */
  }
  signal?.throwIfAborted()
  const document = { source, ...parseDocxParts(xml, relationships, canonicalText) }
  if (!current || !(await sameVersion(source))) {
    document.order = 'text-first'
    document.parts = [
      ...(canonicalText ? [{ kind: 'text' as const, start: 0, end: canonicalText.length }] : []),
      ...document.images.map((image) => ({ kind: 'image' as const, occurrenceIndex: image.index }))
    ]
    for (const image of document.images) image.omission = 'source-changed'
  } else if (!document.discoveryFailure) {
    signal?.throwIfAborted()
    cacheParts(document)
  }
  signal?.throwIfAborted()
  return document
}

async function readImage(
  zip: JSZip,
  target: string,
  signal?: AbortSignal
): Promise<Uint8Array | 'missing-image' | 'image-byte-limit' | 'unreadable-image'> {
  const member = zip.file(target)
  if (!member) return 'missing-image'
  const stream = new Readable({ read() {} }).wrap(member.nodeStream())
  const abort = () => stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'))
  signal?.addEventListener('abort', abort, { once: true })
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      size += chunk.length
      if (size > 16_000_000) {
        stream.destroy()
        return 'image-byte-limit'
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } catch {
    signal?.throwIfAborted()
    return 'unreadable-image'
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export async function materializeDocumentImages(
  document: DocumentParts,
  occurrenceIndices: readonly number[],
  signal?: AbortSignal
): Promise<MaterializedDocumentImage[]> {
  signal?.throwIfAborted()
  const omitted = (reason: 'source-changed' | 'unreadable-image'): MaterializedDocumentImage[] =>
    occurrenceIndices.map((occurrenceIndex) => ({ occurrenceIndex, kind: 'omitted', reason }))
  if (!(await sameVersion(document.source))) {
    for (const image of document.images) image.omission = 'source-changed'
    return omitted('source-changed')
  }
  let zip: JSZip
  try {
    zip = await readArchive(document.source, signal)
  } catch {
    signal?.throwIfAborted()
    return omitted('unreadable-image')
  }
  const selected = new Set(occurrenceIndices)
  const results = new Map<number, MaterializedDocumentImage>()
  const representatives = new Map<string, number>()
  // An empty selection warms only metadata, so admission can precede raster normalization.
  const last = occurrenceIndices.length ? Math.max(...occurrenceIndices) : document.images.length - 1
  let transientFailure = false
  for (const image of document.images) {
    if (image.index > last) break
    signal?.throwIfAborted()
    let bytes: Uint8Array | undefined
    if (!image.omission && image.target && !image.sha256) {
      const read = await readImage(zip, image.target, signal)
      if (typeof read === 'string') {
        image.omission = read
        transientFailure ||= read === 'unreadable-image'
      } else {
        bytes = read
        Object.assign(image, await inspectDocumentImage(read))
      }
    }
    if (image.sha256) {
      const first = representatives.get(image.sha256)
      if (first !== undefined) {
        image.duplicateOf = first
        image.omission = 'duplicate'
      } else representatives.set(image.sha256, image.index)
    }
    if (!selected.has(image.index)) continue
    if (image.omission) {
      results.set(image.index, { occurrenceIndex: image.index, kind: 'omitted', reason: image.omission })
      continue
    }
    if (!bytes) {
      const read = image.target ? await readImage(zip, image.target, signal) : 'missing-image'
      if (typeof read === 'string') {
        transientFailure ||= read === 'unreadable-image'
        results.set(image.index, { occurrenceIndex: image.index, kind: 'omitted', reason: read })
        continue
      }
      bytes = read
    }
    results.set(image.index, { occurrenceIndex: image.index, ...(await normalizeDocumentImage(bytes)) })
  }
  signal?.throwIfAborted()
  if (!(await sameVersion(document.source))) {
    for (const image of document.images) image.omission = 'source-changed'
    return omitted('source-changed')
  }
  signal?.throwIfAborted()
  if (!transientFailure && !document.discoveryFailure) cacheParts(document)
  return occurrenceIndices.map(
    (index) => results.get(index) ?? { occurrenceIndex: index, kind: 'omitted', reason: 'missing-image' }
  )
}
