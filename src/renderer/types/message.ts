import type OpenAI from '@cherrystudio/openai'
import type { LivePartPatch } from '@shared/ai/messageProjection'
import type { CherryUIMessage, CherryMessagePart } from '@shared/data/types/message'

export interface ProjectionPartReader {
  read(partId: string): CherryMessagePart | undefined
  subscribe(partId: string, listener: () => void): () => void
}

export interface ProjectionLayoutSlot {
  readonly partId: string
}

export type ProjectionLayoutNode =
  | { readonly slots: readonly ProjectionLayoutSlot[] }
  | { readonly children: readonly ProjectionLayoutNode[] }

export interface ProjectionLayoutReader {
  row(messageId: string): ProjectionRowReader | undefined
}

export interface ProjectionRowReader {
  getSnapshot(): ProjectionLayoutNode
  subscribe(listener: () => void): () => void
}

export type MessageTextChange = {
  messageId: string
  partId: string
  turnOrigin?: NonNullable<CherryUIMessage['metadata']>['turnOrigin']
} & (
  | { type: 'text-open'; afterTextPartId?: string }
  | ({ type: 'text-append'; offset: number } & Pick<Extract<LivePartPatch, { type: 'part-append' }>, 'text'>)
  | { type: 'text-correct'; text: string }
)

export interface ExecutionFinishEvent {
  attemptId: number
  userMessageId?: string
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

export type ExecutionContentUpdate = { attemptId: number } & (
  | { type: 'snapshot'; message: CherryUIMessage; partId?: never; text?: never }
  | (MessageTextChange & { message?: never })
)

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
  /** Active reply when browsing was saved; ignore the selection after branch navigation. */
  foldSelectedBranchId?: string | null
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
