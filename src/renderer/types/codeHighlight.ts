import type { DocumentChange, HighlightResult, SnapshotRequest, TokensResult } from '@cherrystudio/ui/code-highlight'

export type { HighlightRange, HighlightResult } from '@cherrystudio/ui/code-highlight'
type Session = { sessionId: string }
type Revision = { revision: number; configurationRevision: number }
export type HighlightRequest =
  | (Session & Revision & { type: 'open'; code: string; language: string; theme: string })
  | (Session & { type: 'update'; baseRevision: number; revision: number; change: DocumentChange })
  | (Session & { type: 'configure'; configurationRevision: number; language: string; theme: string })
  | (Session & Revision & { type: 'read'; range: { start: number; end: number } })
  | (Session & { type: 'close' })
  | { type: 'snapshot'; request: SnapshotRequest }
  | { type: 'html'; code: string; language: string; theme: string }
  | { type: 'markdown'; code: string; theme: string }
export type HighlightValue = HighlightResult | TokensResult | string | null
export type HighlightResponse = { id: number; generation: number } & (
  | { result: HighlightValue; sessionId?: string; revision?: number; configurationRevision?: number }
  | { error: string; missing?: boolean }
)
