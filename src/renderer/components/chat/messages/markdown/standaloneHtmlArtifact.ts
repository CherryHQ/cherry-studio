import type { HtmlArtifactKind } from './plugins/remarkHtmlArtifact'

export interface StandaloneHtmlArtifact {
  html: string
  kind: HtmlArtifactKind
  source: 'document' | 'fence'
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

  let closingStart = end
  while (closingStart > openingLineEnd + 1 && source[closingStart - 1] === marker) closingStart -= 1
  if (end - closingStart < markerEnd - start) {
    if (!isStreaming) return undefined
    const html = source.slice(openingLineEnd + 1, end)
    return {
      html,
      kind: /^\s*(?:<!doctype(?:\s|>)|<html(?:\s|>))/i.test(html) ? 'document' : 'fragment',
      source: 'fence'
    }
  }
  if (closingStart > openingLineEnd + 1 && source[closingStart - 1] !== '\n') return undefined

  const htmlEnd = closingStart > openingLineEnd + 1 ? closingStart - 1 : closingStart
  const html = source.slice(openingLineEnd + 1, htmlEnd)
  return {
    html,
    kind: /^\s*(?:<!doctype(?:\s|>)|<html(?:\s|>))/i.test(html) ? 'document' : 'fragment',
    source: 'fence'
  }
}

function scanStandaloneHtmlDocument(
  source: string,
  start: number,
  end: number,
  isStreaming: boolean
): StandaloneHtmlArtifact | undefined {
  const prefix = source.slice(start, Math.min(end, start + 512))
  if (!/^(?:<!--(?:[\s\S]*?)-->\s*)*(?:<!doctype(?:\s|>)|<html(?:\s|>))/i.test(prefix)) return undefined

  if (!isStreaming) {
    const closingStart = source.toLowerCase().lastIndexOf('</html', end)
    if (closingStart < start) return undefined
    const closingEnd = source.indexOf('>', closingStart + 6)
    if (closingEnd === -1 || skipWhitespace(source, closingEnd + 1, end) !== end) return undefined
  }

  return { html: source.slice(start, end), kind: 'document', source: 'document' }
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
