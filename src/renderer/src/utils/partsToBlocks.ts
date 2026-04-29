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

/**
 * Convert ContentReference[] (new format) to legacy citationReferences shape.
 * The renderer expects `{ citationBlockId?, citationBlockSource? }[]`.
 *
 * Note: Only web citations are converted. Knowledge and memory citations are not
 * supported by the legacy citationReferences format and are silently dropped.
 */
export function convertReferencesToLegacyCitations(
  references: ContentReference[],
  blockId: string
): MainTextMessageBlock['citationReferences'] {
  const citations = references.filter((ref): ref is CitationReference => ref.category === ReferenceCategory.CITATION)
  if (citations.length === 0) return undefined

  const nonWebCitations = citations.filter((ref) => !isWebCitation(ref))
  if (nonWebCitations.length > 0) {
    logger.warn('Non-web citations dropped during legacy conversion (knowledge/memory not supported)', {
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

  if (!url) return null

  const title =
    (typeof entry.title === 'string' && entry.title) ||
    (typeof openAiUrlCitation?.title === 'string' && openAiUrlCitation.title) ||
    (typeof webEntry?.title === 'string' && webEntry.title) ||
    toHostOrUrl(url)

  const content = (typeof entry.content === 'string' && entry.content) || extractOpenRouterContent(entry)

  return {
    number: 0,
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

  return list
    .map(normalizeWebResult)
    .filter((c): c is Citation => c !== null)
    .map((c, index) => ({ ...c, number: index + 1 }))
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
  return all
    .filter((citation) => {
      if (citation.type === 'knowledge' || citation.type === 'memory') return true
      if (!citation.url || urlSet.has(citation.url)) return false
      urlSet.add(citation.url)
      return true
    })
    .map((citation, index) => ({
      ...citation,
      number: index + 1
    }))
}
