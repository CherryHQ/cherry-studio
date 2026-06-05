import {
  type CherryMessagePart,
  type CherryUIMessage,
  CitationType,
  type ContentReference,
  ReferenceCategory
} from '@shared/data/types/message'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import type { SourceUrlUIPart } from 'ai'

type TextPart = CherryMessagePart & { type: 'text'; text?: string }

type WebCitationResult = {
  number: number
  url: string
  title?: string
  content?: string
}

function isTextPart(part: CherryMessagePart): part is TextPart {
  return part.type === 'text'
}

function isSourceUrlPart(part: CherryMessagePart): part is SourceUrlUIPart {
  return part.type === 'source-url' && typeof part.url === 'string'
}

function toHostOrUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function cleanReferenceText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sourceIdToNumber(sourceId: unknown): number | undefined {
  if (typeof sourceId !== 'string') return undefined
  const match = sourceId.match(/^citation-(\d+)$/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value >= 0 ? value + 1 : undefined
}

function buildSourceUrlResults(parts: readonly CherryMessagePart[]): WebCitationResult[] {
  const seenUrls = new Set<string>()
  const results: WebCitationResult[] = []

  for (const part of parts) {
    if (!isSourceUrlPart(part) || !part.url || seenUrls.has(part.url)) continue
    seenUrls.add(part.url)
    const number = sourceIdToNumber(part.sourceId) ?? results.length + 1
    results.push({
      number,
      url: part.url,
      title: part.title || toHostOrUrl(part.url)
    })
  }

  return results
}

function hasExistingReferences(part: TextPart): boolean {
  const references = readCherryMeta(part)?.references
  return Array.isArray(references) && references.length > 0
}

function hasInlineCitationMarker(content: string, results: readonly WebCitationResult[]): boolean {
  if (!content || results.length === 0) return false
  const numbers = new Set(results.map((result) => result.number))
  const markerRegex = /\[(?:<sup>)?(\d+)(?:<\/sup>)?\]/g
  let match: RegExpExecArray | null
  while ((match = markerRegex.exec(content)) !== null) {
    if (numbers.has(Number(match[1]))) return true
  }
  return false
}

function createWebReference(source: 'ai-sdk' | 'websearch', results: WebCitationResult[]): ContentReference {
  return {
    category: ReferenceCategory.CITATION,
    citationType: CitationType.WEB,
    content: {
      source,
      results
    }
  }
}

function extractMarkdownReferenceResults(content: string): WebCitationResult[] {
  const headingMatch = content.match(/^#{1,6}\s*(?:参考文献|参考资料|引用|references?|sources?)\s*$/im)
  if (!headingMatch || headingMatch.index === undefined) return []

  const sectionStart = headingMatch.index + headingMatch[0].length
  const afterHeading = content.slice(sectionStart)
  const nextHeadingMatch = afterHeading.match(/^#{1,6}\s+\S+/m)
  const section = nextHeadingMatch?.index === undefined ? afterHeading : afterHeading.slice(0, nextHeadingMatch.index)

  const seenNumbers = new Set<number>()
  const results: WebCitationResult[] = []

  for (const line of section.split('\n')) {
    const lineMatch = line.match(/^\s*\[(\d+)\]\s+(.+?)\s*$/)
    if (!lineMatch) continue

    const number = Number(lineMatch[1])
    if (!Number.isFinite(number) || seenNumbers.has(number)) continue

    const referenceText = lineMatch[2].trim()
    const urlMatch = referenceText.match(/https?:\/\/\S+/)
    const url = urlMatch?.[0].replace(/[),.;]+$/, '') ?? ''
    const beforeUrl = urlMatch?.index === undefined ? referenceText : referenceText.slice(0, urlMatch.index).trim()
    const emphasizedTitle = beforeUrl.match(/\*([^*]+)\*/)?.[1]
    const title = cleanReferenceText(emphasizedTitle || beforeUrl)
    if (!title) continue

    seenNumbers.add(number)
    results.push({
      number,
      url,
      title,
      content: cleanReferenceText(beforeUrl)
    })
  }

  return results
}

function normalizeTextPart(part: TextPart, sourceUrlResults: readonly WebCitationResult[]): TextPart {
  if (hasExistingReferences(part)) return part

  const content = part.text ?? ''
  if (hasInlineCitationMarker(content, sourceUrlResults)) {
    return withCherryMeta(part, { references: [createWebReference('ai-sdk', [...sourceUrlResults])] })
  }

  const markdownResults = extractMarkdownReferenceResults(content)
  if (!hasInlineCitationMarker(content, markdownResults)) return part

  return withCherryMeta(part, { references: [createWebReference('websearch', markdownResults)] })
}

export function normalizeAssistantMessageCitations(message: CherryUIMessage): CherryUIMessage {
  const parts = message.parts as CherryMessagePart[]
  const sourceUrlResults = buildSourceUrlResults(parts)
  let changed = false

  const normalizedParts = parts.map((part) => {
    if (!isTextPart(part)) return part
    const normalizedPart = normalizeTextPart(part, sourceUrlResults)
    if (normalizedPart !== part) changed = true
    return normalizedPart
  })

  if (!changed) return message
  return { ...message, parts: normalizedParts }
}
