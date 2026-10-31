/**
 * Canonical reasoning-effort destinations resolved at Cherry's agent-session
 * boundary, keyed by agent session id.
 *
 * The Claude Code SDK transport accepts only low|medium|high|xhigh|max, so a
 * mapped destination outside that vocabulary (GPT-5 minimal) crosses the
 * gateway boundary as its Anthropic-serialized tier (low). The gateway
 * restores the session's canonical destination during target serialization
 * when the request carries a validated internal session header; external
 * clients keep their literal effort untouched, and the user effort map stays
 * applied exactly once, at the session boundary (cherry-pr-review
 * inv_234f741ac324acb8).
 */
const canonicalEffortBySession = new Map<string, string>()

/** Record the session's canonical (already user-map-applied) effort destination. */
export function registerSessionCanonicalEffort(sessionId: string, effort: string): void {
  canonicalEffortBySession.set(sessionId, effort)
}

/** The session's canonical effort destination, when its boundary resolved one. */
export function resolveSessionCanonicalEffort(sessionId: string): string | undefined {
  return canonicalEffortBySession.get(sessionId)
}

/** Drop the session's recorded destination (session disposal and tests). */
export function clearSessionCanonicalEffort(sessionId: string): void {
  canonicalEffortBySession.delete(sessionId)
}

/**
 * Overwrite-or-clear the session's recorded destination from a boundary
 * build. A rebuild that resolves a disabled/default effort - or a route that
 * no longer crosses the gateway - must not keep the previous destination:
 * the gateway would restore a stale tier over the session's new literal
 * intent.
 */
export function syncSessionCanonicalEffort(sessionId: string, canonicalEffort: string | undefined): void {
  if (canonicalEffort) {
    registerSessionCanonicalEffort(sessionId, canonicalEffort)
  } else {
    clearSessionCanonicalEffort(sessionId)
  }
}
