/**
 * `Message` content readers.
 *
 * Plain-text extractors over `Message.parts` for export / copy / context
 * building. Pure — no Redux, no DataApi, no v1 block shapes. Parts are the
 * single source of truth.
 */
import * as z from 'zod'

import type { Citation } from '@renderer/types/message'
import type { ExportableMessage } from '@renderer/types/messageExport'
import { convertReferencesToCitations } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { toExportableCitations } from './citations'

function getParts(message: ExportableMessage): CherryMessagePart[] {
  return message.parts ?? []
}

const exportPartFieldsSchema = z.object({ type: z.string(), text: z.string().catch(''), data: z.unknown().optional() })
const exportStringField = z.string().optional().catch(undefined)
const exportCodeFieldsSchema = z.object({ content: exportStringField, language: exportStringField })
const exportTranslationFieldsSchema = z.object({ content: exportStringField })

const exportErrorFieldsSchema = z.object({
  name: exportStringField,
  code: z.union([z.string(), z.number()]).optional().catch(undefined),
  message: exportStringField
})

const flatCitationFieldsSchema = z.object({
  category: z.literal('citation'),
  url: z.string(),
  title: exportStringField,
  number: z.number().optional().catch(undefined)
})

function formatCodePart(data: z.infer<typeof exportCodeFieldsSchema> | undefined): string {
  const content = data?.content ?? ''

  if (!content.trim()) return ''
  const language = data?.language ?? ''

  return `\`\`\`${language}\n${content}\n\`\`\``
}

function formatErrorPart(data: z.infer<typeof exportErrorFieldsSchema> | undefined): string {
  if (!data) return ''

  return [data.name, data.code, data.message].filter(Boolean).join('\n')
}

function renderExportPart(part: z.infer<typeof exportPartFieldsSchema>): string {
  switch (part.type) {
    case 'text':
      return part.text
    case 'data-code': {
      const data = exportCodeFieldsSchema.safeParse(part.data)

      return formatCodePart(data.success ? data.data : undefined)
    }

    case 'data-translation': {
      const data = exportTranslationFieldsSchema.safeParse(part.data)

      return data.success ? (data.data.content ?? '') : ''
    }

    case 'data-error': {
      const data = exportErrorFieldsSchema.safeParse(part.data)

      return formatErrorPart(data.success ? data.data : undefined)
    }

    default:
      return ''
  }
}

/**
 * Canonical part → Markdown serialization for the text-like part types
 * (`text` / `data-code` / `data-translation` / `data-error`). Every export path
 * must go through this so a code part keeps its fences and language tag.
 */
export function getRenderableTextContent(part: CherryMessagePart): string {
  const parsed = exportPartFieldsSchema.safeParse(part)

  return parsed.success ? renderExportPart(parsed.data) : ''
}

// Auxiliary part types whose text belongs in a full export but must NOT steer
// the topic-naming / summary prompt — error dumps and raw translations would
// pollute the generated title.
const NAMING_EXCLUDED_PART_TYPES = new Set<string>(['data-error', 'data-translation'])

function collectText(message: ExportableMessage, excludedTypes?: ReadonlySet<string>): string {
  return getParts(message)
    .flatMap((part) => {
      const parsed = exportPartFieldsSchema.safeParse(part)

      if (!parsed.success || excludedTypes?.has(parsed.data.type)) return []
      const text = renderExportPart(parsed.data)

      return text.trim().length > 0 ? [text] : []
    })
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
    .flatMap((part) => {
      const parsed = exportPartFieldsSchema.safeParse(part)

      return parsed.success && parsed.data.type === 'reasoning' && parsed.data.text.trim().length > 0
        ? [parsed.data.text]
        : []
    })
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
    const parsedPart = exportPartFieldsSchema.safeParse(part)

    if (!parsedPart.success || parsedPart.data.type !== 'text' || part.type !== 'text') continue

    const refs = readCherryMeta(part)?.references ?? []

    for (const ref of refs) {
      const parsed = flatCitationFieldsSchema.safeParse(ref)

      if (!parsed.success) continue
      const citation = parsed.data

      if (!citation.url) continue
      const number = citation.number ?? lines.length + 1
      const title = citation.title || citation.url.slice(0, 1999)
      lines.push(`[${number}] [${title}](${citation.url.slice(0, 1999)})`)
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
export const getToolCitationExport = (message: ExportableMessage, content: string) => {
  // Legacy [N] markers keep their stored numbering; yield to them only when
  // their references produce citations, matching MainTextBlock.
  const rendersLegacyCitations = getParts(message).some((part) => {
    const parsed = exportPartFieldsSchema.safeParse(part)

    if (!parsed.success || parsed.data.type !== 'text' || part.type !== 'text') return false
    const references = readCherryMeta(part)?.references

    return !!references?.length && convertReferencesToCitations(references).length > 0
  })

  if (rendersLegacyCitations) return { content, citation: '' }
  const priorParts = 'priorCitationParts' in message ? (message.priorCitationParts ?? []) : []
  const { content: exported, cited } = toExportableCitations(content, getParts(message), priorParts)

  return { content: exported, citation: formatCitationLines(cited) }
}
