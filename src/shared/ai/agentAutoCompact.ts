/**
 * Auto-compact trigger percentage (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, an integer, not a 0-1 fraction),
 * shared by the renderer form and the Claude Code settings builder.
 *
 * Cherry Studio policy uses 10-80 with default 80 to leave headroom for bursty tool results.
 * This is not the CLI's range or default: the pinned CLI accepts positive percentages through 100
 * and caps the threshold at the effective context window minus 13,000 tokens.
 */
export const DEFAULT_AUTO_COMPACT_TRIGGER_PCT = 80

export const MIN_AUTO_COMPACT_TRIGGER_PCT = 10

/** Resolve a stored or form-entered percentage: unset/invalid means default, otherwise clamp into [MIN, DEFAULT]. */
export function normalizeAutoCompactTriggerPct(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_AUTO_COMPACT_TRIGGER_PCT
  return Math.min(Math.max(Math.round(raw), MIN_AUTO_COMPACT_TRIGGER_PCT), DEFAULT_AUTO_COMPACT_TRIGGER_PCT)
}
