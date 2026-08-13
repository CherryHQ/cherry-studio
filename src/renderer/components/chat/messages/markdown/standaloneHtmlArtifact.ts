import type { Point } from 'unist'

import type { HtmlArtifactKind } from './plugins/remarkHtmlArtifact'

export interface StandaloneHtmlArtifact {
  html: string
  kind: HtmlArtifactKind
  source: 'document' | 'fence'
  /** Opening position in the original Markdown, so code-block saves keep matching the remark node. */
  start: Point
}

function skipWhitespace(value: string, start: number, end = value.length): number {
  let index = start
  while (index < end && /\s/.test(value[index])) index += 1
  return index
}

function trimEndIndex(value: string): number {
  let index = value.length
  while (index > 0 && /\s/.test(value[index - 1])) index -= 1
  return index
}

function toPoint(source: string, offset: number): Point {
  const before = source.slice(0, offset)
  return { line: before.split('\n').length, column: offset - (before.lastIndexOf('\n') + 1) + 1, offset }
}

function classifyHtml(html: string): HtmlArtifactKind {
  return /^\s*(?:<!doctype(?:\s|>)|<html(?:\s|>))/i.test(html) ? 'document' : 'fragment'
}

/** Finds the CommonMark closing fence line, returning where the fenced content and the line end. */
function findClosingFence(source: string, from: number, end: number, marker: string, minCount: number) {
  for (let lineStart = from; lineStart < end; ) {
    const newline = source.indexOf('\n', lineStart)
    const lineEnd = newline === -1 || newline > end ? end : newline
    let cursor = lineStart
    while (cursor < lineEnd && cursor - lineStart < 4 && (source[cursor] === ' ' || source[cursor] === '\t'))
      cursor += 1
    const indent = cursor - lineStart
    let count = 0
    while (cursor < lineEnd && source[cursor] === marker) {
      cursor += 1
      count += 1
    }
    if (indent < 4 && count >= minCount && skipWhitespace(source, cursor, lineEnd) === lineEnd) {
      return { contentEnd: lineStart, lineEnd }
    }
    if (lineEnd === end) break
    lineStart = lineEnd + 1
  }
  return undefined
}

function scanStandaloneHtmlFence(
  source: string,
  start: number,
  end: number,
  isStreaming: boolean
): StandaloneHtmlArtifact | undefined {
  const marker = source[start]
  if ((marker !== '`' && marker !== '~') || source[start + 1] !== marker || source[start + 2] !== marker) {
    return undefined
  }

  let markerEnd = start + 3
  while (source[markerEnd] === marker) markerEnd += 1
  const openingLineEnd = source.indexOf('\n', markerEnd)
  if (openingLineEnd === -1) return undefined
  const language = source.slice(markerEnd, openingLineEnd).trim()
  if (!/^html?$/i.test(language)) return undefined

  const contentStart = openingLineEnd + 1
  const closing = findClosingFence(source, contentStart, end, marker, markerEnd - start)
  if (!closing) {
    // An unterminated fence is only an artifact while the message is still arriving.
    if (!isStreaming) return undefined
    const html = source.slice(contentStart, end)
    return { html, kind: classifyHtml(html), source: 'fence', start: toPoint(source, start) }
  }

  // Anything after a closed fence makes this mixed Markdown, streaming or not.
  if (skipWhitespace(source, closing.lineEnd, end) !== end) return undefined

  const html = source.slice(contentStart, Math.max(contentStart, closing.contentEnd - 1))
  return { html, kind: classifyHtml(html), source: 'fence', start: toPoint(source, start) }
}

function scanStandaloneHtmlDocument(
  source: string,
  start: number,
  end: number,
  isStreaming: boolean
): StandaloneHtmlArtifact | undefined {
  const prefix = source.slice(start, Math.min(end, start + 512))
  if (!/^(?:<!--(?:[\s\S]*?)-->\s*)*(?:<!doctype(?:\s|>)|<html(?:\s|>))/i.test(prefix)) return undefined

  const closingStart = source.toLowerCase().lastIndexOf('</html', end)
  const closingEnd = closingStart >= start ? source.indexOf('>', closingStart + 6) : -1
  if (closingEnd !== -1 && closingEnd < end) {
    if (skipWhitespace(source, closingEnd + 1, end) !== end) return undefined
  } else if (!isStreaming) {
    return undefined
  }

  return { html: source.slice(start, end), kind: 'document', source: 'document', start: toPoint(source, start) }
}

/** Recognizes only content whose entire message is one HTML artifact. */
export function scanStandaloneHtmlArtifact(source: string, isStreaming = false): StandaloneHtmlArtifact | undefined {
  const start = skipWhitespace(source, 0)
  const end = trimEndIndex(source)
  if (start === end) return undefined

  return (
    scanStandaloneHtmlFence(source, start, end, isStreaming) ??
    scanStandaloneHtmlDocument(source, start, end, isStreaming)
  )
}
