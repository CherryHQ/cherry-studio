import type { CacheComposerAttachment, CacheComposerDraftBase } from '@shared/data/cache/cacheValueTypes'

export interface ConversationNavigationTarget {
  conversationType: 'assistant' | 'agent'
  conversationId: string
}

/** An attachment on its way to another window; IPC cannot carry a `Blob`, so in-memory content travels as bytes. */
export interface ConversationDraftAttachment extends Omit<CacheComposerAttachment, 'blob'> {
  bytes?: Uint8Array
  mimeType?: string
}

/** An unsent composer draft handed to the window that opens the conversation. */
export interface ConversationDraft extends Omit<CacheComposerDraftBase, 'files'> {
  files: ConversationDraftAttachment[]
}
