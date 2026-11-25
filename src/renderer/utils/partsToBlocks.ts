/**
 * Citation reference helpers — projects stored reference entries (V2 storage
 * format on `text` parts' `providerMetadata.cherry.references`) to the
 * renderer's `Citation` and inline `citationReferences` shapes that
 * `MainTextBlock` / `CitationsList` consume.
 *
 * The bulk of this file used to be a v2→v1 block-shape converter
 * (`partToBlock` / `mapMessageStatusToBlockStatus`) that fed the legacy
 * `messageBlocks` Redux slice. That slice and its writers are gone — only
 * the citation-reference projections remain, which are still needed by
 * `MessagePartsRenderer` to render inline citations from text-part metadata.
 */
import * as z from 'zod'

import type { Citation } from '@renderer/types/message'
import { type WebSearchSource, WebSearchSourceSchema } from '@renderer/types/webSearchProvider'
import { CitationType, ReferenceCategory } from '@shared/data/types/message'

const citationDescriptorSchema = z.object({
  category: z.literal(ReferenceCategory.CITATION),
  citationType: z.enum(CitationType),
  content: z.unknown().optional()
})

const optionalCitationString = z.string().optional().catch(undefined)

const webReferenceFieldsSchema = z.object({
  results: z.unknown().optional(),
  source: WebSearchSourceSchema.optional().catch(undefined)
})

const knowledgeCitationFieldsSchema = z.object({
  id: z.number().optional().catch(undefined),
  content: optionalCitationString,
  sourceUrl: optionalCitationString
})

const memoryCitationFieldsSchema = z.object({ memory: optionalCitationString, hash: optionalCitationString })

const groundingChunkFieldsSchema = z.object({
  web: z.object({ uri: optionalCitationString, title: optionalCitationString }).optional().catch(undefined)
})

export type CitationReferenceView = {
  citationBlockId?: string
  citationBlockSource?: WebSearchSource
}

/**
 * Convert stored citation descriptors to the inline citationReferences shape.
 * The renderer expects `{ citationBlockId?, citationBlockSource? }[]`.
 *
 * Knowledge/memory citations carry no web-search source; their inline `[N]`
 * markers resolve through the default plain-bracket normalization branch.
 */
export function convertReferencesToCitationReferences(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored metadata admits unknown reference entries; project only citation descriptors and validated web source names.
  references: readonly unknown[],
  blockId: string
): CitationReferenceView[] | undefined {
  const citations = references.flatMap((ref) => {
    const parsed = citationDescriptorSchema.safeParse(ref)

    return parsed.success ? [parsed.data] : []
  })

  if (citations.length === 0) return undefined

  return citations.map((ref) => {
    const web = ref.citationType === CitationType.WEB ? webReferenceFieldsSchema.safeParse(ref.content) : undefined

    return { citationBlockId: blockId, citationBlockSource: web?.success ? web.data.source : undefined }
  })
}

function toHostOrUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Persisted provider references have unvalidated extension fields; only the nested content string is consumed.
function extractOpenRouterContent(entry: Record<string, unknown>): string | undefined {
  if (!entry.providerMetadata || typeof entry.providerMetadata !== 'object') return undefined
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The metadata object is checked above; its provider-specific values remain unvalidated.
  const providerMetadata = entry.providerMetadata as Record<string, unknown>

  if (!providerMetadata.openrouter || typeof providerMetadata.openrouter !== 'object') return undefined
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The namespace object is checked above; content is accepted only after the string check below.
  const openrouterMeta = providerMetadata.openrouter as Record<string, unknown>

  return typeof openrouterMeta.content === 'string' ? openrouterMeta.content : undefined
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Stored citation fields are unvalidated; only a finite positive number may enter the display projection.
function readExplicitCitationNumber(entry: Record<string, unknown>): number {
  const value = entry.number

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored web references contain provider-specific URL strings or result objects; verify each consumed citation field before projecting it.
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
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The object container is checked; each URL, title, content and citation number is validated before use.
  const entry = result as Record<string, unknown>

  // SAFETY: The branch checks the nested citation container; URL and title stay unknown until their string checks.
  const openAiUrlCitation =
    entry.url_citation && typeof entry.url_citation === 'object'
      ? // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The nested citation object is checked; URL and title remain unknown until the string checks below.
        (entry.url_citation as Record<string, unknown>)
      : undefined

  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The web container is checked; provider-specific fields remain unknown until the scalar readers validate them.
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- WebCitationReference deliberately leaves persisted results untyped; distinguish Gemini grounding, result envelopes and arrays before reading individual citations.
function normalizeWebResults(results: unknown): Citation[] {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: Only the object container is checked; stored provider extension fields remain unvalidated.
  const obj = results && typeof results === 'object' ? (results as Record<string, unknown>) : undefined

  // Gemini grounding format: { groundingChunks, groundingSupports }
  if (obj && Array.isArray(obj.groundingChunks)) {
    const chunks: readonly unknown[] = obj.groundingChunks

    const groundingSupports: Citation['metadata'] =
      obj.groundingSupports && Array.isArray(obj.groundingSupports) ? obj.groundingSupports : undefined

    return chunks
      .values()
      .map((chunk, index) => {
        const parsed = groundingChunkFieldsSchema.safeParse(chunk)
        const web = parsed.success ? parsed.data.web : undefined
        const url = web?.uri ?? ''

        if (!url) return null

        const citation: Citation = {
          number: index + 1,
          url,
          title: web?.title ?? toHostOrUrl(url),
          showFavicon: true,
          type: 'websearch'
        }

        if (groundingSupports) citation.metadata = groundingSupports

        return citation
      })
      .filter((citation) => citation !== null)
      .toArray()
  }

  const list = Array.isArray(results) ? results : obj && Array.isArray(obj.results) ? obj.results : []

  return list.map(normalizeWebResult).filter((c): c is Citation => c !== null)
}

function assignMissingCitationNumbers(citations: Citation[]): Citation[] {
  const assigned = new Set(citations.flatMap((citation) => (citation.number > 0 ? [citation.number] : [])))
  let nextNumber = 1

  return citations.map((citation) => {
    if (citation.number > 0) return citation

    while (assigned.has(nextNumber)) nextNumber += 1
    assigned.add(nextNumber)

    return { ...citation, number: nextNumber }
  })
}

/**
 * Convert stored reference entries to renderer Citation[].
 * Used by MessagePartsRenderer to preserve inline citation tagging.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Historical reference entries and their rows are unvalidated; preserve valid fields and numbering without claiming a complete ContentReference.
export function convertReferencesToCitations(references: readonly unknown[]): Citation[] {
  const all: Citation[] = []

  for (const ref of references) {
    const parsed = citationDescriptorSchema.safeParse(ref)

    if (!parsed.success) continue
    const reference = parsed.data

    if (reference.citationType === CitationType.WEB) {
      const web = webReferenceFieldsSchema.safeParse(reference.content)
      all.push(...normalizeWebResults(web.success ? web.data.results : undefined))
      continue
    }

    if (reference.citationType === CitationType.KNOWLEDGE) {
      const knowledge = Array.isArray(reference.content) ? reference.content : []
      // Keep the migrated item id as the display number so inline [N] markers
      // in the text resolve; on a collision with an already-claimed number
      // (possible in mixed migrated data) fall back to sequential assignment.
      const usedNumbers = new Set(all.flatMap((citation) => (citation.number > 0 ? [citation.number] : [])))
      all.push(
        ...knowledge.flatMap((item) => {
          const parsed = knowledgeCitationFieldsSchema.safeParse(item)

          if (!parsed.success) return []
          const fields = parsed.data
          const id = fields.id ?? 0
          const number = id > 0 && !usedNumbers.has(id) ? id : 0

          if (number > 0) usedNumbers.add(number)
          // Migrated file sources store a whole markdown link; unwrap it so the title
          // and http://file target remain readable and resolvable.
          const fileMatch = fields.sourceUrl?.match(/\[(.*?)]\(http:\/\/file\/(.*?)\)/)

          return [
            {
              number,
              url: fileMatch ? `http://file/${fileMatch[2]}` : fields.sourceUrl || '',
              title: fileMatch ? fileMatch[1] : fields.sourceUrl || '',
              content: fields.content,
              showFavicon: true,
              type: 'knowledge' as const
            }
          ]
        })
      )
      continue
    }

    if (reference.citationType === CitationType.MEMORY) {
      const memories = Array.isArray(reference.content) ? reference.content : []
      all.push(
        ...memories.flatMap((item) => {
          const parsed = memoryCitationFieldsSchema.safeParse(item)

          if (!parsed.success) return []
          const fields = parsed.data

          return [
            {
              number: 0,
              url: '',
              title: `Memory ${fields.hash?.slice(0, 8) || ''}`.trim(),
              content: fields.memory,
              showFavicon: false,
              type: 'memory' as const
            }
          ]
        })
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
