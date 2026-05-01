/**
 * Re-export shared builtin-tool wire contracts. Main and renderer share the
 * same source of truth in `@shared/data/types/builtin-tools`.
 *
 * TODO(renderer/aiCore-cleanup): apply the same migration to memory once
 * its agentic rewrite lands.
 */
export type {
  KbSearchInput as KnowledgeSearchToolInput,
  KbSearchOutput as KnowledgeSearchToolOutput,
  KbSearchOutputItem as KnowledgeSearchToolOutputItem,
  WebSearchInput as WebSearchToolInput,
  WebSearchOutput as WebSearchToolOutput,
  WebSearchOutputItem as WebSearchToolOutputItem
} from '@shared/data/types/builtin-tools'

export interface MemorySearchToolInput {
  query?: string
  limit?: number
}

export type MemorySearchToolOutput = Array<{
  id?: string
  content?: string
  text?: string
  score?: number
}>
