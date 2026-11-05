import type OpenAI from '@cherrystudio/openai'

export type Usage = OpenAI.Completions.CompletionUsage & {
  thoughts_tokens?: number
  // Cache token breakdown (AI SDK v6 `inputTokenDetails`)
  cache_read_tokens?: number
  cache_write_tokens?: number
}

export type Metrics = {
  completion_tokens: number
  time_completion_millsec: number
  time_first_token_millsec?: number
  time_thinking_millsec?: number
}

export interface MessageUiState {
  foldSelected?: boolean
  multiModelMessageStyle?: string
  useful?: boolean
  disclosures?: Record<string, boolean>
}

export interface Citation {
  number: number
  url: string
  title?: string
  hostname?: string
  content?: string
  showFavicon?: boolean
  type?: string
  metadata?: Record<string, any>
}

/**
 * Load-all pagination handle for the multi-select "select all" action.
 * Topic/agent history is cursor-paginated server-side, so select-all must
 * page to the end (parts resident) before it can apply and export.
 */
export interface MessageListSelectAllPagination {
  /** Whether older pages remain unloaded on the server. */
  hasOlder: boolean
  /** True while a requested load-all is still fetching older pages. */
  isLoading: boolean
  /** Keep auto-paginating until every page is loaded (idempotent). */
  start: () => void
  /** Stop an in-progress load-all, abandoning the remaining pages. */
  stop: () => void
}
