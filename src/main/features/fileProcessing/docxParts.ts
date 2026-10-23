import { posix } from 'node:path'

import { XMLParser, XMLValidator } from 'fast-xml-parser'

import type { DocumentImageOccurrence, DocumentPart, DocumentParts } from './types'

type XmlNode = { [key: string]: XmlNode[] | Record<string, string> | string }
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false
})
const MAX_ALIGNMENT_UNITS = 2_000_000
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim()

function splitParagraphLines(text: string): { text: string; start: number }[] {
  let start = 0
  return text.split(/\r?\n/u).map((line) => {
    const entry = { text: line, start }
    start += line.length + (text[start + line.length] === '\r' ? 2 : 1)
    return entry
  })
}

function getNormalizedPrefixLengths(text: string): number[] {
  const lengths = [0]
  let length = 0
  let pendingWhitespace = false
  for (let offset = 0; offset < text.length; offset++) {
    if (/\s/u.test(text[offset])) {
      pendingWhitespace = length > 0
    } else {
      length += pendingWhitespace ? 2 : 1
      pendingWhitespace = false
    }
    lengths.push(length)
  }
  return lengths
}

function parse(xml: string): XmlNode[] {
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid XML')
  return parser.parse(xml)
}

function children(node: XmlNode, key: string): XmlNode[] {
  return Array.isArray(node[key]) ? node[key] : []
}

export function parseDocxParts(
  documentXml: string,
  relationshipsXml: string | null,
  canonicalText: string | null
): Omit<DocumentParts, 'source'> {
  const images: DocumentImageOccurrence[] = []
  const fallback = (): Omit<DocumentParts, 'source'> => ({
    text: canonicalText,
    order: 'text-first',
    parts: [
      ...(canonicalText ? [{ kind: 'text' as const, start: 0, end: canonicalText.length }] : []),
      ...images.map((image) => ({ kind: 'image' as const, occurrenceIndex: image.index }))
    ],
    images,
    imageCount: { total: images.length, known: images.length }
  })
  let tree: XmlNode[]
  try {
    tree = parse(documentXml)
    if (!tree.some((node) => children(node, 'document').some((child) => Array.isArray(child.body)))) {
      throw new Error('Missing body')
    }
  } catch {
    return { ...fallback(), imageCount: { total: null, known: 0 }, discoveryFailure: 'unreadable-document-xml' }
  }
  const relationships = new Map<string, string>()
  try {
    const root = relationshipsXml ? parse(relationshipsXml) : []
    for (const node of root.flatMap((node) => children(node, 'Relationships'))) {
      if (!Array.isArray(node.Relationship)) continue
      const attrs = node[':@'] as Record<string, string> | undefined
      if (!attrs || attrs['@_TargetMode'] === 'External') continue
      const target = attrs['@_Target']
      if (!target || target.includes('\\') || target.includes(':') || target.includes('?') || target.includes('#'))
        continue
      let decoded: string
      try {
        decoded = decodeURIComponent(target)
      } catch {
        continue
      }
      const resolved = posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : `word/${decoded}`)
      if (
        resolved === '..' ||
        resolved.startsWith('../') ||
        resolved.startsWith('/') ||
        resolved.includes('\0') ||
        resolved.includes(':') ||
        resolved.includes('\\')
      )
        continue
      relationships.set(attrs['@_Id'], resolved)
    }
  } catch {
    /* Unreadable relationships leave each reference explicitly unresolved. */
  }

  const paragraphs: Array<{ text: string; images: Array<{ index: number; offset: number }> }> = []
  let xmlTextLength = 0
  function walk(nodes: XmlNode[], paragraph?: (typeof paragraphs)[number]): void {
    for (const node of nodes) {
      const key = Object.keys(node).find((key) => key !== ':@' && key !== '#text')
      if (!key) continue
      if (key === 'AlternateContent') {
        const alternatives = children(node, key)
        const choice = alternatives.find((child) => Array.isArray(child.Choice))
        const selected = choice ?? alternatives.find((child) => Array.isArray(child.Fallback))
        if (selected) walk(children(selected, choice ? 'Choice' : 'Fallback'), paragraph)
        continue
      }
      if (key === 'p') {
        const next = { text: '', images: [] as Array<{ index: number; offset: number }> }
        paragraphs.push(next)
        walk(children(node, key), next)
        xmlTextLength += next.text.length
      } else if (paragraph && key === 't') {
        paragraph.text += children(node, key)
          .map((child) => child['#text'] ?? '')
          .join('')
      } else if (paragraph && (key === 'br' || key === 'cr')) {
        paragraph.text += '\n'
      } else if (paragraph && key === 'tab') {
        paragraph.text += '\t'
      } else if (paragraph && key === 'blip') {
        const attrs = node[':@'] as Record<string, string> | undefined
        const id = attrs?.['@_embed']
        const target = id ? relationships.get(id) : undefined
        const index = images.length
        images.push({ index, ...(target ? { target } : { omission: 'broken-relationship' as const }) })
        paragraph.images.push({ index, offset: paragraph.text.length })
      } else {
        walk(children(node, key), paragraph)
      }
    }
  }
  const body = tree.flatMap((node) => children(node, 'document')).flatMap((node) => children(node, 'body'))
  walk(body)
  if (canonicalText === null) return fallback()
  if (canonicalText.length + xmlTextLength + paragraphs.length + 1 > MAX_ALIGNMENT_UNITS / (images.length + 1))
    return fallback()
  const canonicalLines = Array.from(canonicalText.matchAll(/[^\r\n]+/gu))
    .map((match) => ({ text: match[0], start: match.index, normalizedText: normalized(match[0]) }))
    .filter((line) => line.normalizedText)
  const paragraphLines = paragraphs.map((paragraph) => {
    let nonemptyCount = 0
    const lines = splitParagraphLines(paragraph.text).map((line) => {
      const normalizedText = normalized(line.text)
      const entry = { ...line, normalizedText, nonemptyBefore: nonemptyCount }
      if (normalizedText) nonemptyCount++
      return entry
    })
    return { lines, nonemptyCount }
  })
  const xmlLines = paragraphLines.flatMap(({ lines }) => lines.filter((line) => line.normalizedText))
  if (
    xmlLines.length !== canonicalLines.length ||
    xmlLines.some((line, i) => line.normalizedText !== canonicalLines[i].normalizedText)
  )
    return fallback()
  if (!canonicalLines.length) return fallback()

  const canonicalOffsets: Array<Map<number, number | null> | undefined> = []
  const boundaries: Array<{ index: number; offset: number }> = []
  let lineIndex = 0
  let previousEnd = 0
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const paragraph = paragraphs[paragraphIndex]
    const { lines, nonemptyCount } = paragraphLines[paragraphIndex]
    const paragraphStart = lineIndex
    let localLineIndex = 0
    let xmlPrefixLengths: number[] | undefined
    for (const image of paragraph.images) {
      while (localLineIndex + 1 < lines.length && image.offset >= lines[localLineIndex + 1].start) {
        localLineIndex++
        xmlPrefixLengths = undefined
      }
      const line = lines[localLineIndex]
      if (!line.normalizedText) {
        if (paragraph.text.length) return fallback()
        boundaries.push({ index: image.index, offset: previousEnd })
        continue
      }
      const canonicalIndex = paragraphStart + line.nonemptyBefore
      const canonical = canonicalLines[canonicalIndex]
      let offsets = canonicalOffsets[canonicalIndex]
      if (!offsets) {
        offsets = new Map<number, number | null>()
        const prefixLengths = getNormalizedPrefixLengths(canonical.text)
        for (let offset = 0; offset < prefixLengths.length; offset++) {
          const length = prefixLengths[offset]
          offsets.set(length, offsets.has(length) ? null : offset)
        }
        canonicalOffsets[canonicalIndex] = offsets
      }
      xmlPrefixLengths ??= getNormalizedPrefixLengths(line.text)
      // A boundary inside CRLF still belongs to the preceding line.
      const relativeOffset = Math.min(image.offset - line.start, line.text.length)
      const offset = offsets.get(xmlPrefixLengths[relativeOffset])
      if (offset === undefined || offset === null) return fallback()
      boundaries.push({ index: image.index, offset: canonical.start + offset })
    }
    lineIndex += nonemptyCount
    if (lineIndex > paragraphStart) {
      const last = canonicalLines[lineIndex - 1]
      previousEnd = last.start + last.text.length
    }
  }
  const parts: DocumentPart[] = []
  let start = 0
  for (const boundary of boundaries) {
    if (boundary.offset < start) return fallback()
    if (boundary.offset > start) parts.push({ kind: 'text', start, end: boundary.offset })
    parts.push({ kind: 'image', occurrenceIndex: boundary.index })
    start = boundary.offset
  }
  if (start < canonicalText.length) parts.push({ kind: 'text', start, end: canonicalText.length })
  return { ...fallback(), order: 'interleaved', parts }
}
