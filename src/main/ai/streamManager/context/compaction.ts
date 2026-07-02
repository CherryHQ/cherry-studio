import { Prompts } from '@context-chef/core'
import { estimateTokenCount } from 'tokenx'

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

/** Build the injected summary row (role 'user', continuation-framed via chef). */
export function summaryRow(boundaryId: string, summary: string): CompactionRow {
  return {
    id: summaryMessageId(boundaryId),
    role: 'user',
    parts: [{ type: 'text', text: Prompts.getCompactSummaryWrapper(summary) }]
  }
}

/** tokenx estimate for one row (text parts dominate; others stringified). */
export function estimateRowTokens(row: CompactionRow): number {
  const text = row.parts.map((p) => (typeof p.text === 'string' ? p.text : JSON.stringify(p))).join('\n')
  return estimateTokenCount(text)
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
export function applyDeepestMarker(rows: CompactionRow[]): CompactionRow[] {
  const d = findDeepestMarker(rows)
  if (d < 0) return rows
  // non-null: findDeepestMarker only returns an index whose compactionSummary is truthy
  return [summaryRow(rows[d].id, rows[d].compactionSummary!), ...rows.slice(d + 1)]
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
export function planKeepBoundary(rows: CompactionRow[], keepBudget: number): number | null {
  let acc = 0
  let keepStart: number | null = null
  for (let i = rows.length - 1; i >= 0; i--) {
    acc += estimateRowTokens(rows[i])
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
