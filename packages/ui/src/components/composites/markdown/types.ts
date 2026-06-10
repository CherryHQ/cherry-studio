/**
 * Status alphabet that the chat layer happens to use. Replicated as a local
 * literal union so this package does not depend on `@shared/data/types/message`.
 * Callers passing the chat-layer's `MessageStatus | 'streaming'` are
 * structurally compatible.
 */
export type MarkdownStatus = 'pending' | 'success' | 'error' | 'paused' | 'streaming'

/**
 * Lightweight interface for Markdown rendering source.
 * Mirrors the chat layer's MarkdownSource so a future Markdown component in
 * this package can consume the same shape callers already pass today.
 */
export interface MarkdownSource {
  id: string
  content: string
  status: MarkdownStatus
}
