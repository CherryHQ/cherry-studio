/**
 * Citation id batch for one lookup call: "3f2a1b9c-1", "3f2a1b9c-2", …
 *
 * The random per-call prefix keeps ids unique across multiple web/kb lookup
 * calls in one assistant message without any request- or session-scoped state,
 * so the AI-SDK tool wrappers and the in-process MCP bridge mint ids the same
 * way. The model cites a result by echoing its id as `[cite:id]`; the renderer
 * resolves markers by exact id match against the message's own tool results, so
 * only intra-message uniqueness matters — but a collision is silent and
 * mis-attributes the marker to the earlier result, so the prefix carries a full
 * 32 bits rather than the handful of characters that uniqueness alone needs.
 */

import { randomUUID } from 'node:crypto'

export function newCitePrefix(): string {
  return randomUUID().slice(0, 8)
}

export function citeId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`
}
