import { estimateTokenCount } from 'tokenx'

import { ContextPrompts } from '@cherrystudio/ai-core'

import type { TokenDialect } from '../../tokens/dialect'
import { imageTokensFor, mediaTokensFor } from '../../tokens/profiles'

/**
 * Lightweight row view for compaction. Built from a raw cherry `Message`
 * (id, role, data.parts, compactionSummary). Kept separate from `CherryUIMessage`
 * so the helpers are pure and trivially testable.
 */
export interface CompactionRow {
  id: string
  role: string
  parts: Array<{ type: string; text?: string; [k: string]: unknown }>
  /** Durable summary covering the conversation up to AND INCLUDING this row. */
  compactionSummary?: string
  /** Real end-of-turn context size persisted on this row (last-step totalTokens), if any. */
  contextTokens?: number
}

/** Synthetic id for an injected summary message — never collides with a real UUID. */
export function summaryMessageId(boundaryId: string): string {
  return `compaction:${boundaryId}`
}

/**
 * Build the injected summary row (role 'user', continuation-framed).
 *
 * Two manifest sections restore the call signals that folding erases. Both are
 * APPEND-ONLY and render nothing when their kind is absent, so a conversation
 * that has neither keeps byte-identical summary text and provider prefix
 * caches hold (the extension contract in `retainedContext.ts`).
 *
 * `attachmentHandles` — the folded user message's file parts are gone from the
 * served view, so without this line the model has no idea an attachment exists
 * or what name `read_file` accepts (runtime-test finding #2).
 *
 * `persistedOutputPaths` — same hole one level down: a folded `<persisted-output>`
 * marker keeps its blob on the fs_read allow-list, but the marker (and with it
 * the physical path fs_read requires) is no longer in the prompt, so the model
 * held a capability it had no legal argument for. Live markers are NOT listed
 * here — they still carry their own path via `getVFSOffloadReminder`.
 *
 * Callers pass ONLY what is folded BEHIND the boundary for both, which is what
 * makes this row a pure function of the boundary: attaching a file or
 * offloading another output later never rewrites its bytes. Handles and paths
 * match the request-level allow-list because both are left-to-right folds — a
 * prefix's values equal the full pass's.
 */
export function summaryRow(
  boundaryId: string,
  summary: string,
  attachmentHandles?: readonly string[],
  persistedOutputPaths?: readonly string[]
): CompactionRow {
  const attachments = attachmentHandles?.length
    ? `\n\n[Files attached in this conversation remain readable in full via the read_file tool: ${attachmentHandles.join(', ')}]`
    : ''
  const persisted = persistedOutputPaths?.length
    ? `\n\n[Tool output archived from this conversation remains readable in full via the fs_read tool at: ${persistedOutputPaths.join(', ')}]`
    : ''
  return {
    id: summaryMessageId(boundaryId),
    role: 'user',
    parts: [{ type: 'text', text: ContextPrompts.getCompactSummaryWrapper(summary) + attachments + persisted }]
  }
}

/**
 * Token estimate for one row: tokenx over the text, per-dialect constants over
 * the media. Stringifying a media part instead fed its base64 payload to the
 * tokenizer and scored a 13 MB MP3 at 3.7 M tokens against the provider's real
 * 20 k (#17837) — enough to trip this trigger on a turn with nothing to fold.
 * The in-loop hook fixed the same bug in #17195; this is the turn-start lane.
 */
export function estimateRowTokens(row: CompactionRow, dialect: TokenDialect): number {
  let total = 0
  for (const part of row.parts) {
    if (typeof part.text === 'string') {
      total += estimateTokenCount(part.text)
      continue
    }
    const mediaTokens = mediaPartTokens(part, dialect)
    total += mediaTokens ?? estimateTokenCount(JSON.stringify(part))
  }
  return total
}

/** Media cost by declared type, or `undefined` when the part carries no media. */
function mediaPartTokens(part: { type: string; [k: string]: unknown }, dialect: TokenDialect): number | undefined {
  const mediaType = typeof part.mediaType === 'string' ? part.mediaType : undefined
  if (!mediaType) return undefined
  if (mediaType.startsWith('image/')) return imageTokensFor(dialect)
  if (mediaType.startsWith('audio/')) return mediaTokensFor(dialect, 'audio')
  if (mediaType.startsWith('video/')) return mediaTokensFor(dialect, 'video')
  return undefined
}

/** Index of the DEEPEST row carrying a compactionSummary, or -1. */
export function findDeepestMarker(rows: CompactionRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].compactionSummary) return i
  }
  return -1
}

/**
 * Replace the marker-covered prefix with a single summary message.
 * Returns the rows unchanged when no row carries a marker. Otherwise returns
 * `[summary(deepest)] + rows after the deepest marker`.
 */
export function applyDeepestMarker(
  rows: CompactionRow[],
  attachmentHandles?: readonly string[],
  persistedOutputPaths?: readonly string[]
): CompactionRow[] {
  const d = findDeepestMarker(rows)
  if (d < 0) return rows
  // non-null: findDeepestMarker only returns an index whose compactionSummary is truthy
  return [
    summaryRow(rows[d].id, rows[d].compactionSummary!, attachmentHandles, persistedOutputPaths),
    ...rows.slice(d + 1)
  ]
}

/**
 * Snap a keep boundary to a `user` row: returns the index (within `rows`) of the
 * EARLIEST user row whose suffix still fits `keepBudget` — i.e. the first row to KEEP.
 *
 * Walks from the tail accumulating tokens and stops as soon as the budget is
 * exceeded (no earlier row can fit). Returns null when everything fits (no
 * compaction) or when the boundary would be index 0 (keep all). Floor: if no
 * user row fits, the LAST user row is kept anyway (its exchange stays verbatim).
 */
export function planKeepBoundary(rows: CompactionRow[], keepBudget: number, dialect: TokenDialect): number | null {
  let acc = 0
  let keepStart: number | null = null
  for (let i = rows.length - 1; i >= 0; i--) {
    acc += estimateRowTokens(rows[i], dialect)
    if (acc > keepBudget) break
    if (rows[i].role === 'user') keepStart = i
  }
  if (keepStart === null) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'user') {
        keepStart = i
        break
      }
    }
  }
  if (keepStart === null || keepStart === 0) return null
  return keepStart
}
