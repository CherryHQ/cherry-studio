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
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim()

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
  const canonicalLines = Array.from(canonicalText.matchAll(/[^\r\n]+/gu))
    .filter((match) => normalized(match[0]))
    .map((match) => ({ text: match[0], start: match.index }))
  const xmlLines = paragraphs.flatMap((paragraph) => paragraph.text.split(/\r?\n/u).filter((line) => normalized(line)))
  if (
    xmlLines.length !== canonicalLines.length ||
    xmlLines.some((line, i) => normalized(line) !== normalized(canonicalLines[i].text))
  )
    return fallback()
  if (!canonicalLines.length) return fallback()

  const boundaries: Array<{ index: number; offset: number }> = []
  let lineIndex = 0
  let previousEnd = 0
  for (const paragraph of paragraphs) {
    const lines = paragraph.text.split(/\r?\n/u)
    const paragraphStart = lineIndex
    for (const image of paragraph.images) {
      const before = paragraph.text.slice(0, image.offset).split(/\r?\n/u)
      const localLineIndex = before.length - 1
      const nonemptyBefore = lines.slice(0, localLineIndex).filter((line) => normalized(line)).length
      const line = lines[localLineIndex]
      if (!normalized(line)) {
        if (paragraph.text.length) return fallback()
        boundaries.push({ index: image.index, offset: previousEnd })
        continue
      }
      const canonical = canonicalLines[paragraphStart + nonemptyBefore]
      const prefix = before.at(-1)!
      const suffix = line.slice(prefix.length)
      const offsets: number[] = []
      for (let offset = 0; offset <= canonical.text.length; offset++) {
        if (
          normalized(canonical.text.slice(0, offset)) === normalized(prefix) &&
          normalized(canonical.text.slice(offset)) === normalized(suffix)
        )
          offsets.push(offset)
      }
      if (offsets.length !== 1) return fallback()
      boundaries.push({ index: image.index, offset: canonical.start + offsets[0] })
    }
    lineIndex += lines.filter((line) => normalized(line)).length
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
