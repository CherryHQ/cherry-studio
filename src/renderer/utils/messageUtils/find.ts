/**
 * `Message` content readers.
 *
 * Plain-text extractors over `Message.parts` for export / copy / context
 * building. Pure — no Redux, no DataApi, no v1 block shapes. Parts are the
 * single source of truth.
 */
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CodePartData, ErrorPartData, TranslationPartData } from '@shared/data/types/uiParts'
import { readCherryMeta } from '@shared/data/types/uiParts'

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

function getRenderableTextContent(part: CherryMessagePart): string {
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
