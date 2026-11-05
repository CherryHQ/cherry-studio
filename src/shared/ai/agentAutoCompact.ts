/**
 * Auto-compact trigger percentage (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, an integer, not a 0-1 fraction),
 * shared by the renderer form and the Claude Code settings builder.
 *
 * The CLI accepts 10-85 but only ever lowers its threshold — values above its default (80) are
 * ignored — so 80 is both the default and the usable maximum. Left at the CLI default, a turn whose
 * tool results land in one burst can jump the remaining headroom and fail outright; 80 keeps roughly
 * a fifth of the window as landing room.
 */
export const DEFAULT_AUTO_COMPACT_TRIGGER_PCT = 80

export const MIN_AUTO_COMPACT_TRIGGER_PCT = 10

/** Resolve a stored or form-entered percentage: unset/invalid means default, otherwise clamp into [MIN, DEFAULT]. */
export function normalizeAutoCompactTriggerPct(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_AUTO_COMPACT_TRIGGER_PCT
  return Math.min(Math.max(Math.round(raw), MIN_AUTO_COMPACT_TRIGGER_PCT), DEFAULT_AUTO_COMPACT_TRIGGER_PCT)
}
