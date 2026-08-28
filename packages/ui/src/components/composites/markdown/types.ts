/**
 * Generic render source status. Kept as `string` so app-specific layers can
 * pass their own status alphabet without coupling this package to chat types.
 */
export type MarkdownStatus = string

/**
 * Lightweight interface for Markdown rendering source.
 * Provides the common id/content/status shape without owning status semantics.
 */
export interface MarkdownSource<TStatus extends MarkdownStatus = MarkdownStatus> {
  id: string
  content: string
  status: TStatus
}
