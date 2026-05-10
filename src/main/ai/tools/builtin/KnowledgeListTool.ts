/**
 * Knowledge base discovery tool — companion to `kb__search`.
 *
 * Returns metadata for the knowledge bases reachable from the current request,
 * with up to 8 sample item sources per base derived from item titles, URLs,
 * paths, or note first-lines. The model uses this to pick which `baseIds` to
 * pass to `kb__search` instead of fanning out blindly.
 *
 * Scope: when `assistant.knowledgeBaseIds` is non-empty, only those bases are
 * returned. When empty (future toggle path), all user bases are returned.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import {
  KB_LIST_TOOL_NAME,
  kbListInputSchema,
  type KbListOutput,
  type KbListOutputItem,
  kbListOutputSchema
} from '@shared/ai/builtinTools'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { tool } from 'ai'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const logger = loggerService.withContext('KnowledgeListTool')

const SAMPLE_LIMIT = 8
const NOTE_SNIPPET_MAX_CHARS = 80

export { KB_LIST_TOOL_NAME }

const kbListTool = tool({
  description: `Browse the user's available knowledge bases before searching.

Returns each base's name, emoji, group, item count, and a few sample sources (filenames, URLs, note titles) so you can judge what topics it likely covers. Call this first when the user asks about their materials and you don't already know which base is relevant — then call kb__search with the chosen baseIds.`,
  inputSchema: kbListInputSchema,
  outputSchema: kbListOutputSchema,
  strict: true,
  execute: async ({ query, groupId }, options): Promise<KbListOutput> => {
    const { request } = getToolCallContext(options)
    const allowedIds = request.assistant?.knowledgeBaseIds ?? []

    const orchestrator = application.get('KnowledgeOrchestrationService')
    const allBases = await orchestrator.listBases()
    const scopedBases = allowedIds.length > 0 ? allBases.filter((base) => allowedIds.includes(base.id)) : allBases

    const groupFiltered = groupId !== undefined ? scopedBases.filter((base) => base.groupId === groupId) : scopedBases

    const items: KbListOutputItem[] = await Promise.all(
      groupFiltered.map(async (base) => buildOutputItem(base, orchestrator))
    )

    const lowered = query?.toLowerCase()
    if (!lowered) return items
    return items.filter((item) => matchesQuery(item, lowered))
  },
  toModelOutput: ({ input, output }) => {
    if (output.length === 0) {
      const filtered = Boolean(input?.query) || Boolean(input?.groupId)
      return {
        type: 'text' as const,
        value: filtered
          ? 'No knowledge bases match the filter. Retry with a broader query or omit groupId to see all available bases.'
          : 'No knowledge bases are available for this assistant. Inform the user that no knowledge base is configured rather than retrying.'
      }
    }
    return { type: 'json' as const, value: output }
  }
})

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
    emoji: base.emoji,
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
      const { origin_name, name } = item.data.file
      const value = origin_name?.trim() || name?.trim()
      return value ? value : null
    }
    case 'url':
    case 'sitemap':
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

export function createKbListToolEntry(): ToolEntry {
  return {
    name: KB_LIST_TOOL_NAME,
    namespace: 'kb',
    description: "List the user's available knowledge bases with sample sources",
    defer: 'auto',
    tool: kbListTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}
