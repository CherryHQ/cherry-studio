export type MarkdownCodeRange = { start: number; end: number }

export type StripCitationMarkersOptions = {
  /** Hide a trailing prefix such as `[ci` or `[cite:source-` until the next stream delta disambiguates it. */
  withholdIncompleteTrailingMarker?: boolean
}

const CITATION_MARKER_PATTERN = /([ \t]?)\[cite:[\w-]+\]/g
const CITATION_MARKER_PREFIX = '[cite:'

function countRun(content: string, start: number, marker: '`' | '~'): number {
  let end = start
  while (content[end] === marker) end += 1
  return end - start
}

function findInlineCodeEnd(content: string, start: number, delimiterLength: number): number | undefined {
  let cursor = start + delimiterLength

  while (cursor < content.length) {
    const candidate = content.indexOf('`', cursor)
    if (candidate < 0) return undefined

    const runLength = countRun(content, candidate, '`')
    if (runLength === delimiterLength) return candidate + runLength
    cursor = candidate + runLength
  }

  return undefined
}

function findFenceRange(content: string, lineStart: number): MarkdownCodeRange | undefined {
  let delimiterStart = lineStart
  while (delimiterStart < lineStart + 4 && content[delimiterStart] === ' ') delimiterStart += 1
  if (delimiterStart - lineStart > 3) return undefined

  const marker = content[delimiterStart]
  if (marker !== '`' && marker !== '~') return undefined

  const delimiterLength = countRun(content, delimiterStart, marker)
  if (delimiterLength < 3) return undefined

  const openingLineEnd = content.indexOf('\n', delimiterStart + delimiterLength)
  const openingContentEnd = openingLineEnd < 0 ? content.length : openingLineEnd
  if (marker === '`' && content.slice(delimiterStart + delimiterLength, openingContentEnd).includes('`')) {
    return undefined
  }

  let closingLineStart = openingLineEnd < 0 ? content.length : openingLineEnd + 1
  while (closingLineStart < content.length) {
    const closingLineEnd = content.indexOf('\n', closingLineStart)
    const closingContentEnd = closingLineEnd < 0 ? content.length : closingLineEnd
    let closingDelimiterStart = closingLineStart
    while (closingDelimiterStart < closingLineStart + 4 && content[closingDelimiterStart] === ' ') {
      closingDelimiterStart += 1
    }

    if (closingDelimiterStart - closingLineStart <= 3 && content[closingDelimiterStart] === marker) {
      const closingLength = countRun(content, closingDelimiterStart, marker)
      const trailing = content.slice(closingDelimiterStart + closingLength, closingContentEnd)
      if (closingLength >= delimiterLength && /^[ \t\r]*$/.test(trailing)) {
        return { start: lineStart, end: closingLineEnd < 0 ? content.length : closingLineEnd + 1 }
      }
    }

    closingLineStart = closingLineEnd < 0 ? content.length : closingLineEnd + 1
  }

  return { start: lineStart, end: content.length }
}

/** Locate Markdown inline-code spans and fenced blocks without changing their source text. */
export function findMarkdownCodeRanges(content: string): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = []
  let cursor = 0

  while (cursor < content.length) {
    const isLineStart = cursor === 0 || content[cursor - 1] === '\n'
    if (isLineStart) {
      const fence = findFenceRange(content, cursor)
      if (fence) {
        ranges.push(fence)
        cursor = fence.end
        continue
      }
    }

    if (content[cursor] === '`') {
      const delimiterLength = countRun(content, cursor, '`')
      const end = findInlineCodeEnd(content, cursor, delimiterLength)
      if (end !== undefined) {
        ranges.push({ start: cursor, end })
        cursor = end
        continue
      }
      cursor += delimiterLength
      continue
    }

    cursor += 1
  }

  return ranges
}

/** Apply a transform only to Markdown prose, preserving inline and fenced code byte-for-byte. */
export function mapMarkdownOutsideCode(content: string, transform: (text: string) => string): string {
  const ranges = findMarkdownCodeRanges(content)
  let cursor = 0
  let result = ''

  for (const range of ranges) {
    result += transform(content.slice(cursor, range.start))
    result += content.slice(range.start, range.end)
    cursor = range.end
  }

  return result + transform(content.slice(cursor))
}

function withholdIncompleteTrailingMarker(text: string): string {
  const markerStart = text.lastIndexOf('[')
  if (markerStart < 0) return text

  const candidate = text.slice(markerStart)
  const isPossibleMarker =
    CITATION_MARKER_PREFIX.startsWith(candidate) ||
    (candidate.startsWith(CITATION_MARKER_PREFIX) && /^[\w-]*$/.test(candidate.slice(CITATION_MARKER_PREFIX.length)))
  if (!isPossibleMarker) return text

  const start = markerStart > 0 && /[ \t]/.test(text[markerStart - 1]) ? markerStart - 1 : markerStart
  return text.slice(0, start)
}

/** Remove internal `[cite:id]` markers from prose while preserving literal examples in code. */
export function stripCitationMarkers(content: string, options?: StripCitationMarkersOptions): string {
  const stripped = mapMarkdownOutsideCode(content, (text) => text.replace(CITATION_MARKER_PATTERN, ''))
  if (!options?.withholdIncompleteTrailingMarker) return stripped

  const lastCodeRange = findMarkdownCodeRanges(stripped).at(-1)
  if (lastCodeRange?.end === stripped.length) return stripped
  return withholdIncompleteTrailingMarker(stripped)
}
