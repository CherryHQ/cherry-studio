/**
 * Citation reference helpers — projects `ContentReference[]` (V2 storage
 * format on `text` parts' `providerMetadata.cherry.references`) to the
 * renderer's `Citation` and legacy `citationReferences` shapes that
 * `MainTextBlock` / `CitationsList` consume.
 *
 * The bulk of this file used to be a v2→v1 block-shape converter
 * (`partToBlock` / `mapMessageStatusToBlockStatus`) that fed the legacy
 * `messageBlocks` Redux slice. That slice and its writers are gone — only
 * the citation-reference projections remain, which are still needed by
 * `PartsRenderer` to render inline citations from text-part metadata.
 */

import { loggerService } from '@logger'
import type { Citation, WebSearchSource } from '@renderer/types/index'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import type { CitationReference, ContentReference } from '@shared/data/types/message'
import { isKnowledgeCitation, isMemoryCitation, isWebCitation, ReferenceCategory } from '@shared/data/types/message'

const logger = loggerService.withContext('partsToBlocks')

export type CitationReferenceView = {
  citationBlockId?: string
  citationBlockSource?: WebSearchSource
}

/**
 * Convert `ContentReference[]` to the v1 block's `citationReferences` shape.
 *
 * `CitationReferenceView` is structurally identical to the legacy element, so
 * the v1 block path (`PartsRenderer`) reuses the single converter below instead
 * of duplicating the projection — only the return type is re-stated for v1
 * callers, keeping them decoupled from the v2-native view type.
 */
export function convertReferencesToLegacyCitations(
  references: ContentReference[],
  blockId: string
): MainTextMessageBlock['citationReferences'] {
  return convertReferencesToCitationReferences(references, blockId)
}

/**
 * Convert `ContentReference[]` (V2 storage format) to the renderer's inline
 * `citationReferences` shape. The single source of truth for citation-reference
 * projection.
 *
 * Note: Only web citations are converted — knowledge and memory citations are
 * not representable in this inline reference format and are silently dropped.
 */
export function convertReferencesToCitationReferences(
  references: ContentReference[],
  blockId: string
): CitationReferenceView[] | undefined {
  const citations = references.filter((ref): ref is CitationReference => ref.category === ReferenceCategory.CITATION)
  if (citations.length === 0) return undefined

  const nonWebCitations = citations.filter((ref) => !isWebCitation(ref))
  if (nonWebCitations.length > 0) {
    logger.warn('Non-web citations dropped during inline citation conversion (knowledge/memory not supported)', {
      droppedCount: nonWebCitations.length
    })
  }

  return citations.filter(isWebCitation).map((ref) => ({
    citationBlockId: blockId,
    citationBlockSource: (ref.content?.source ?? undefined) as WebSearchSource | undefined
  }))
}

function toHostOrUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function extractOpenRouterContent(entry: Record<string, unknown>): string | undefined {
  if (!entry.providerMetadata || typeof entry.providerMetadata !== 'object') return undefined
  const providerMetadata = entry.providerMetadata as Record<string, unknown>
  if (!providerMetadata.openrouter || typeof providerMetadata.openrouter !== 'object') return undefined
  const openrouterMeta = providerMetadata.openrouter as Record<string, unknown>
  return typeof openrouterMeta.content === 'string' ? openrouterMeta.content : undefined
}

function readExplicitCitationNumber(entry: Record<string, unknown>): number {
  const value = entry.number
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeWebResult(result: unknown): Citation | null {
  if (typeof result === 'string') {
    return {
      number: 0,
      url: result,
      title: toHostOrUrl(result),
      showFavicon: true,
      type: 'websearch'
    }
  }

  if (!result || typeof result !== 'object') return null
  const entry = result as Record<string, unknown>
  const openAiUrlCitation =
    entry.url_citation && typeof entry.url_citation === 'object'
      ? (entry.url_citation as Record<string, unknown>)
      : undefined
  const webEntry = entry.web && typeof entry.web === 'object' ? (entry.web as Record<string, unknown>) : undefined

  const url =
    (typeof entry.url === 'string' && entry.url) ||
    (typeof entry.link === 'string' && entry.link) ||
    (typeof openAiUrlCitation?.url === 'string' && openAiUrlCitation.url) ||
    (typeof webEntry?.uri === 'string' && webEntry.uri) ||
    ''

  const title =
    (typeof entry.title === 'string' && entry.title) ||
    (typeof openAiUrlCitation?.title === 'string' && openAiUrlCitation.title) ||
    (typeof webEntry?.title === 'string' && webEntry.title) ||
    toHostOrUrl(url)

  const content = (typeof entry.content === 'string' && entry.content) || extractOpenRouterContent(entry)
  if (!url && !title && !content) return null

  return {
    number: readExplicitCitationNumber(entry),
    url,
    title,
    content,
    showFavicon: true,
    type: 'websearch'
  }
}

function normalizeWebResults(results: unknown): Citation[] {
  // Gemini grounding format: { groundingChunks, groundingSupports }
  if (results && typeof results === 'object' && Array.isArray((results as Record<string, unknown>).groundingChunks)) {
    const obj = results as Record<string, unknown>
    const chunks = obj.groundingChunks as Array<Record<string, unknown>>
    const groundingSupports =
      obj.groundingSupports && Array.isArray(obj.groundingSupports) ? (obj.groundingSupports as unknown[]) : undefined

    return chunks
      .map((chunk, index) => {
        const web = chunk?.web && typeof chunk.web === 'object' ? (chunk.web as Record<string, unknown>) : undefined
        const url = typeof web?.uri === 'string' ? web.uri : ''
        if (!url) return null
        // NOTE: metadata is actually an array (groundingSupports) despite Citation.metadata
        // being Record<string, any>. Downstream citation.ts calls metadata.forEach() directly.
        // TODO: fix Citation.metadata type to support this shape properly.
        return {
          number: index + 1,
          url,
          title: typeof web?.title === 'string' ? web.title : toHostOrUrl(url),
          showFavicon: true,
          type: 'websearch',
          ...(groundingSupports ? { metadata: groundingSupports } : {})
        } as Citation
      })
      .filter(Boolean) as Citation[]
  }

  const list = Array.isArray(results)
    ? results
    : results && typeof results === 'object' && Array.isArray((results as Record<string, unknown>).results)
      ? ((results as Record<string, unknown>).results as unknown[])
      : []

  return list.map(normalizeWebResult).filter((c): c is Citation => c !== null)
}

function assignMissingCitationNumbers(citations: Citation[]): Citation[] {
  const assigned = new Set(citations.filter((citation) => citation.number > 0).map((citation) => citation.number))
  let nextNumber = 1

  return citations.map((citation) => {
    if (citation.number > 0) return citation
    while (assigned.has(nextNumber)) nextNumber += 1
    assigned.add(nextNumber)
    return { ...citation, number: nextNumber }
  })
}

/**
 * Convert ContentReference[] (new format) to renderer Citation[].
 * Used by V2 PartsRenderer to preserve inline citation tagging.
 */
export function convertReferencesToCitations(references: ContentReference[]): Citation[] {
  const all: Citation[] = []

  for (const ref of references) {
    if (isWebCitation(ref)) {
      all.push(...normalizeWebResults(ref.content?.results))
      continue
    }

    if (isKnowledgeCitation(ref)) {
      const knowledge = Array.isArray(ref.content) ? ref.content : []
      all.push(
        ...knowledge.map((item) => ({
          number: 0,
          url: item.sourceUrl || '',
          title: item.sourceUrl || '',
          content: item.content,
          showFavicon: true,
          type: 'knowledge'
        }))
      )
      continue
    }

    if (isMemoryCitation(ref)) {
      const memories = Array.isArray(ref.content) ? ref.content : []
      all.push(
        ...memories.map((item) => ({
          number: 0,
          url: '',
          title: `Memory ${item.hash?.slice(0, 8) || ''}`.trim(),
          content: item.memory,
          showFavicon: false,
          type: 'memory'
        }))
      )
    }
  }

  const urlSet = new Set<string>()
  const unique = all.filter((citation) => {
    if (citation.type === 'knowledge' || citation.type === 'memory') return true
    if (!citation.url) return true
    if (urlSet.has(citation.url)) return false
    urlSet.add(citation.url)
    return true
  })

  return assignMissingCitationNumbers(unique)
}
