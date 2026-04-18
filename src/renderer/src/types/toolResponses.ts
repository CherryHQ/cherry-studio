/** TODO(renderer/aiCore-cleanup): replace these temporary mirrored tool response types with shared/main-owned contracts once knowledge/web/memory tools stop depending on legacy aiCore definitions. */
export interface KnowledgeSearchToolInput {
  additionalContext?: string
}

export interface KnowledgeSearchToolOutputItem {
  id: string
  content: string
  sourceUrl?: string
  type?: string
  file?: unknown
  metadata?: unknown
}

export type KnowledgeSearchToolOutput = KnowledgeSearchToolOutputItem[]

export interface WebSearchToolInput {
  additionalContext?: string
}

export interface WebSearchToolOutputItem {
  query?: string
  results: Array<{
    title: string
    url: string
    content?: string
    snippet?: string
  }>
}

export interface WebSearchToolOutput {
  results?: WebSearchToolOutputItem[]
}

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
