/**
 * Citation id batch for one lookup call: "k3f-1", "k3f-2", …
 *
 * The random per-call prefix keeps ids unique across multiple web/kb lookup
 * calls in one assistant message without any request- or session-scoped state,
 * which neither the AI-SDK tool wrappers nor the in-process MCP bridge can
 * share. The model cites a result by echoing its id as `[cite:id]`; the
 * renderer resolves markers by exact id match against the message's own tool
 * results, so only intra-message uniqueness matters (46656 prefixes).
 */

export function newCitePrefix(): string {
  return Math.random().toString(36).slice(2, 5).padEnd(3, '0')
}

export function citeId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`
}
