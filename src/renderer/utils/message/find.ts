/**
 * `Message` content readers.
 *
 * Plain-text extractors over `Message.parts` for export / copy / context
 * building. Pure — no Redux, no DataApi, no v1 block shapes. Parts are the
 * single source of truth.
 */
import type { Citation } from '@renderer/types/message'
import type { ExportableMessage } from '@renderer/types/messageExport'
import {
  CITATION_MARKER_PATTERN,
  determineCitationSource,
  mapMarkdownOutsideCode,
  normalizeCitationMarks
} from '@renderer/utils/citation'
import { convertReferencesToCitationReferences, convertReferencesToCitations } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart, ContentReference } from '@shared/data/types/message'
import type { CodePartData, ErrorPartData, TranslationPartData } from '@shared/data/types/uiParts'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { resolveCitationMarkerParts, resolveMessageCitations, toExportableCitations } from './citations'

function getParts(message: ExportableMessage): CherryMessagePart[] {
  return message.parts ?? []
}

function getDataPart<T>(part: CherryMessagePart): Partial<T> | undefined {
  if ('data' in part && part.data && typeof part.data === 'object') {
    return part.data as Partial<T>
  }
  return undefined
}

function formatCodePart(data: Partial<CodePartData> | undefined): string {
  const content = data?.content ?? ''
  if (!content.trim()) return ''
  const language = data?.language ?? ''
  return `\`\`\`${language}\n${content}\n\`\`\``
}

function formatErrorPart(data: Partial<ErrorPartData> | undefined): string {
  if (!data) return ''
  return [data.name, data.code, data.message].filter(Boolean).join('\n')
}

/**
 * Canonical part → Markdown serialization for the text-like part types
 * (`text` / `data-code` / `data-translation` / `data-error`). Every export path
 * must go through this so a code part keeps its fences and language tag.
 */
export function getRenderableTextContent(part: CherryMessagePart): string {
  switch (part.type) {
    case 'text':
      return part.text ?? ''
    case 'data-code':
      return formatCodePart(getDataPart<CodePartData>(part))
    case 'data-translation':
      return getDataPart<TranslationPartData>(part)?.content ?? ''
    case 'data-error':
      return formatErrorPart(getDataPart<ErrorPartData>(part))
    default:
      return ''
  }
}

// Auxiliary part types whose text belongs in a full export but must NOT steer
// the topic-naming / summary prompt — error dumps and raw translations would
// pollute the generated title.
const NAMING_EXCLUDED_PART_TYPES = new Set<CherryMessagePart['type']>(['data-error', 'data-translation'])

function collectText(message: ExportableMessage, excludedTypes?: ReadonlySet<CherryMessagePart['type']>): string {
  return getParts(message)
    .filter((part) => !excludedTypes?.has(part.type))
    .map(getRenderableTextContent)
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

// ── Public API ───────────────────────────────────────────────────────

export const getMainTextContent = (message: ExportableMessage): string => collectText(message)

/**
 * Clean plain text for paths that want the answer only — topic-naming / summary
 * prompts and copy-to-clipboard. Same as `getMainTextContent` but drops
 * `data-error` / `data-translation` parts, so error dumps and translations don't
 * reach the naming model or the clipboard. Full-fidelity **export** keeps
 * `getMainTextContent` (both kinds included).
 */
export const getNamingTextContent = (message: ExportableMessage): string =>
  collectText(message, NAMING_EXCLUDED_PART_TYPES)

export const getThinkingContent = (message: ExportableMessage): string => {
  return getParts(message)
    .filter((p): p is Extract<CherryMessagePart, { type: 'reasoning' }> => p.type === 'reasoning')
    .map((p) => p.text ?? '')
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

export const getCitationContent = (message: ExportableMessage): string => {
  // V2 stores citations on text parts via `providerMetadata.cherry.references`
  // (not as separate `data-citation` parts). Walk text parts and format each
  // citation-category reference into `[N] [title](url)` — same shape v1's
  // `formatCitationsFromBlock` produced. Non-web reference categories are
  // dropped just like the v1 path did.
  const lines: string[] = []
  for (const part of getParts(message)) {
    if (part.type !== 'text') continue
    const refs = (readCherryMeta(part)?.references ?? []) as Array<{
      category?: string
      number?: number
      title?: string
      url?: string
    }>
    for (const ref of refs) {
      if (ref.category !== 'citation') continue
      if (!ref.url) continue
      const number = ref.number ?? lines.length + 1
      const title = ref.title || ref.url.slice(0, 1999)
      lines.push(`[${number}] [${title}](${ref.url.slice(0, 1999)})`)
    }
  }
  return lines.join('\n\n')
}

const formatCitationLines = (citations: Citation[]): string =>
  citations
    .map((citation) => {
      const title = citation.title || citation.url || ''
      // Knowledge-base citations have no URL — list the document title on its own
      // rather than emitting an empty link.
      return citation.url
        ? `[${citation.number}] [${title}](${citation.url.slice(0, 1999)})`
        : `[${citation.number}] ${title}`
    })
    .join('\n\n')

/**
 * Export / copy view of a message whose citations come from its own tool results
 * and, via `priorCitationParts`, those of earlier messages in the conversation.
 *
 * These carry no `providerMetadata.cherry.references`: the model writes `[cite:id]`
 * markers straight into the text (see `./citations`). Both halves therefore have to
 * be derived here — the text with each marker rewritten to a plain `[N]`, and the
 * matching sources list, which {@link getCitationContent} cannot produce.
 */
export const getToolCitationExport = (
  message: ExportableMessage,
  content: string
): { content: string; citation: string } => {
  // Legacy reference metadata wins, mirroring MainTextBlock: those messages number
  // their `[N]` markers from the stored references, so resolving them here would
  // renumber the text by first appearance and drift from that sources list.
  //
  // Gate on the same predicate the renderer uses (MainTextBlock: references present
  // AND they yield citations). `getCitationContent` cannot stand in for it — it reads
  // a flat `ref.url` that the real nested `WebCitationReference` shape never has, so
  // it returns '' for migrated messages that do render legacy citations.
  const rendersLegacyCitations = getParts(message).some((part) => {
    if (part.type !== 'text') return false
    const references = readCherryMeta(part)?.references as ContentReference[] | undefined
    return !!references?.length && convertReferencesToCitations(references).length > 0
  })
  if (rendersLegacyCitations) return { content, citation: '' }
  const priorParts = 'priorCitationParts' in message ? (message.priorCitationParts ?? []) : []
  const { content: exported, cited } = toExportableCitations(content, getParts(message), priorParts)
  return { content: exported, citation: formatCitationLines(cited) }
}

const WEB_SOURCE_URL = /^https?:\/\//i

/**
 * Webpage citations the answer's own text cites, in display order with their display numbers.
 * Reasoning and tool output never contribute; knowledge and memory sources are excluded.
 */
export const getCitedWebSources = (message: ExportableMessage): Citation[] => {
  const parts = getParts(message)
  const priorParts = 'priorCitationParts' in message ? (message.priorCitationParts ?? []) : []
  // Mirror MessagePartsRenderer: a text part whose own references yield citations is legacy and
  // resolves against them; every other text part resolves natively. Native parts resolve
  // independently (no Markdown state leaks across parts) but share one display-number sequence.
  const legacyByPart = new Map<CherryMessagePart, Citation[]>()
  const nativeParts: CherryMessagePart[] = []
  for (const part of parts) {
    if (part.type !== 'text') continue
    const references = (readCherryMeta(part)?.references as ContentReference[] | undefined) ?? []
    const citations = convertReferencesToCitations(references)
    if (citations.length > 0) legacyByPart.set(part, citations)
    else nativeParts.push(part)
  }
  // Same lookup as the renderer: earlier turns always join the message's own sources, so a bare
  // marker resolves to the same URL on screen and in the copied list.
  const messageCitations = resolveMessageCitations(parts, priorParts)
  const nativeResolutions = resolveCitationMarkerParts(
    nativeParts.map((part) => (part.type === 'text' ? (part.text ?? '') : '')),
    messageCitations
  )
  const nativeByPart = new Map(nativeParts.map((part, index) => [part, nativeResolutions[index].cited]))

  const cited: Citation[] = []
  const seen = new Set<string>()
  const add = (citation: Citation) => {
    // A URL is one source however many parts cite it; keep the first occurrence and its number.
    const key = citation.url ? `${citation.type}:${citation.url}` : `${citation.type}:${citation.number}`
    if (seen.has(key)) return
    seen.add(key)
    cited.push(citation)
  }
  for (const part of parts) {
    if (part.type !== 'text') continue
    const legacy = legacyByPart.get(part)
    if (!legacy) {
      for (const citation of nativeByPart.get(part) ?? []) add(citation)
      continue
    }
    const references = (readCherryMeta(part)?.references as ContentReference[] | undefined) ?? []
    const source = determineCitationSource(convertReferencesToCitationReferences(references, ''))
    const normalized = normalizeCitationMarks(part.text ?? '', new Map(legacy.map((c) => [c.number, c])), source)
    const numbers = new Set<number>()
    mapMarkdownOutsideCode(normalized, (text) => {
      for (const match of text.matchAll(CITATION_MARKER_PATTERN)) numbers.add(Number(match[2]))
      return text
    })
    // A number shared by several references resolves to the last one, like the renderer's marker lookup.
    const byNumber = new Map(legacy.map((c) => [c.number, c]))
    for (const citation of legacy)
      if (numbers.has(citation.number) && byNumber.get(citation.number) === citation) add(citation)
  }
  return cited.filter((citation) => citation.type === 'websearch' && WEB_SOURCE_URL.test(citation.url))
}

// Escape everything CommonMark would read as syntax inside link text, so a title like `<div>` stays literal.
const escapeLinkText = (text: string): string => text.replace(/[\\[\]<>&]/g, '\\$&')
// Percent-encode what would end or split the destination (whitespace, controls, brackets, backslash)
// and write `&` as `&amp;` where a Markdown parser would read a character reference (`&copy;`).
const needsPercentEncoding = (character: string): boolean => {
  const code = character.charCodeAt(0)
  return code <= 0x20 || code === 0x7f || /[<>\\\u00a0]/.test(character)
}
const escapeLinkDestination = (url: string): string =>
  Array.from(url, (character) =>
    needsPercentEncoding(character)
      ? `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
      : character
  )
    .join('')
    .replace(/[()]/g, '\\$&')
    .replace(/&(?=#\d+;|#x[\da-f]+;|[a-z][a-z\d]*;)/gi, '&amp;')

/** One `[N] [title](url)` line per cited webpage, keeping the answer's citation numbers (gaps included). */
export const getWebSourcesMarkdown = (message: ExportableMessage): string =>
  getCitedWebSources(message)
    .map((citation) => {
      const title = citation.title?.replace(/\s+/g, ' ').trim() || citation.url
      return `[${citation.number}] [${escapeLinkText(title)}](${escapeLinkDestination(citation.url)})`
    })
    .join('\n\n')
