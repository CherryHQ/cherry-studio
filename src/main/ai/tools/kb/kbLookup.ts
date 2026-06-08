/**
 * Knowledge base search / list core — runtime-agnostic.
 *
 * Single source of truth shared by the AI-SDK builtin tools (`kb_search` /
 * `kb_list`) and the Claude Code in-process MCP bridge. `allowedIds` scopes
 * which bases are reachable: in the AI-SDK path it is the assistant's
 * `knowledgeBaseIds`; an empty array means "no scope" (all user bases),
 * which is what the Claude Code agent path passes since agents have no
 * per-assistant knowledge scope.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { KbListOutput, KbListOutputItem, KbSearchOutput } from '@shared/ai/builtinTools'
import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('KbLookup')

const SAMPLE_LIMIT = 8
const NOTE_SNIPPET_MAX_CHARS = 80

export const KB_SEARCH_DESCRIPTION = `Search the user's private knowledge base — local documents, notes, web clippings.

Use this when:
- The user references "my notes" / "my documents" / their own materials
- The question references topics likely covered in stored documents
- Specific factual lookup that isn't general knowledge

Workflow: call kb_list first to discover available bases and their contents, then call this tool with the chosen baseIds. You may call this multiple times with refined queries or different baseIds if the first results are insufficient. Cite sources by [id] in your final answer.`

export const KB_LIST_DESCRIPTION = `Browse the user's available knowledge bases before searching.

Returns each base's name, group, item count, and a few sample sources (filenames, URLs, note titles) so you can judge what topics it likely covers. Call this first when the user asks about their materials and you don't already know which base is relevant — then call kb_search with the chosen baseIds.`

export async function searchKb(query: string, baseIds: string[], allowedIds: string[]): Promise<KbSearchOutput> {
  const targetIds = allowedIds.length > 0 ? baseIds.filter((id) => allowedIds.includes(id)) : baseIds

  if (targetIds.length === 0) return []

  if (allowedIds.length > 0 && targetIds.length < baseIds.length) {
    const rejected = baseIds.filter((id) => !allowedIds.includes(id))
    logger.warn('Dropped baseIds outside the assistant scope', { rejected, allowedIds })
  }

  const orchestrator = application.get('KnowledgeOrchestrationService')
  const perBaseResults = await Promise.all(
    targetIds.map(async (baseId) => {
      try {
        return await orchestrator.search(baseId, query)
      } catch (error) {
        logger.warn('KnowledgeOrchestrationService.search failed', {
          baseId,
          query,
          error: error instanceof Error ? error.message : String(error)
        })
        return [] as KnowledgeSearchResult[]
      }
    })
  )

  const merged = perBaseResults.flat()
  const dedupedByContent = new Map<string, KnowledgeSearchResult>()
  for (const result of merged) {
    const existing = dedupedByContent.get(result.pageContent)
    if (!existing || result.score > existing.score) {
      dedupedByContent.set(result.pageContent, result)
    }
  }
  const sorted = [...dedupedByContent.values()].sort((a, b) => b.score - a.score)

  return sorted.map((result, index) => ({
    id: index + 1,
    content: result.pageContent,
    // Clamp to the schema's [0, 1] range; the AI-SDK path validates the final
    // array against `kbSearchOutputSchema` after this returns.
    score: Math.max(0, Math.min(1, result.score))
  }))
}

export function kbSearchModelOutput(
  output: KbSearchOutput
): { type: 'text'; value: string } | { type: 'json'; value: KbSearchOutput } {
  if (output.length === 0) {
    return {
      type: 'text',
      value:
        'No matches in the requested knowledge bases. If you are not sure which bases to search, call kb_list first to inspect available bases and their sample sources, then retry kb_search with refined baseIds or query.'
    }
  }
  return { type: 'json', value: output }
}

export async function listKb(
  query: string | undefined,
  groupId: string | undefined,
  allowedIds: string[]
): Promise<KbListOutput> {
  const orchestrator = application.get('KnowledgeOrchestrationService')
  const allBases = await orchestrator.listBases()
  const scopedBases = allowedIds.length > 0 ? allBases.filter((base) => allowedIds.includes(base.id)) : allBases

  const groupFiltered = groupId !== undefined ? scopedBases.filter((base) => base.groupId === groupId) : scopedBases

  // Cap concurrency: a user with 50+ KBs would otherwise fire 50 concurrent
  // listRootItems queries against SQLite + the vector store on every kb_list
  // call. 8 in-flight is enough to keep the agent loop responsive without
  // overwhelming the orchestrator.
  const items: KbListOutputItem[] = await mapWithConcurrency(groupFiltered, 8, (base) =>
    buildOutputItem(base, orchestrator)
  )

  const lowered = query?.toLowerCase()
  if (!lowered) return items
  return items.filter((item) => matchesQuery(item, lowered))
}

export function kbListModelOutput(
  output: KbListOutput,
  input: { query?: string; groupId?: string }
): { type: 'text'; value: string } | { type: 'json'; value: KbListOutput } {
  if (output.length === 0) {
    const filtered = Boolean(input?.query) || Boolean(input?.groupId)
    return {
      type: 'text',
      value: filtered
        ? 'No knowledge bases match the filter. Retry with a broader query or omit groupId to see all available bases.'
        : 'No knowledge bases are available for this assistant. Inform the user that no knowledge base is configured rather than retrying.'
    }
  }
  return { type: 'json', value: output }
}

async function buildOutputItem(
  base: KnowledgeBase,
  orchestrator: { listRootItems: (id: string) => Promise<KnowledgeItem[]> }
): Promise<KbListOutputItem> {
  let rootItems: KnowledgeItem[] = []
  if (base.status === 'completed') {
    try {
      rootItems = await orchestrator.listRootItems(base.id)
    } catch (error) {
      logger.warn('KnowledgeOrchestrationService.listRootItems failed', {
        baseId: base.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const completedItems = rootItems.filter((item) => item.status === 'completed')
  const sampleSources = completedItems
    .slice(0, SAMPLE_LIMIT)
    .map(deriveSampleSource)
    .filter((source): source is string => source !== null)

  return {
    id: base.id,
    name: base.name,
    groupId: base.groupId,
    status: base.status,
    documentCount: base.documentCount ?? 0,
    itemCount: rootItems.length,
    sampleSources
  }
}

function deriveSampleSource(item: KnowledgeItem): string | null {
  switch (item.type) {
    case 'file': {
      const legacyFile = (item.data as { file?: { origin_name?: string; name?: string } }).file
      const value =
        legacyFile?.origin_name?.trim() ||
        legacyFile?.name?.trim() ||
        item.data.source.trim() ||
        item.data.fileEntryId.trim()
      return value ? value : null
    }
    case 'url':
      return item.data.url.trim() || null
    case 'directory':
      return item.data.path.trim() || null
    case 'note': {
      const firstLine = item.data.content.split(/\r?\n/).find((line) => line.trim().length > 0)
      if (!firstLine) return null
      const trimmed = firstLine.trim()
      return trimmed.length > NOTE_SNIPPET_MAX_CHARS ? `${trimmed.slice(0, NOTE_SNIPPET_MAX_CHARS - 1)}…` : trimmed
    }
    default:
      return null
  }
}

function matchesQuery(item: KbListOutputItem, lowered: string): boolean {
  if (item.name.toLowerCase().includes(lowered)) return true
  return item.sampleSources.some((source) => source.toLowerCase().includes(lowered))
}

/** Run `mapper` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await mapper(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
