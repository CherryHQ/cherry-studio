/**
 * Heartbeat tuning constants shared by the renderer form (AgentEditDialog)
 * and the main-side schedule sync — the single source of truth both sides
 * default and clamp against.
 */

/** Form default and fallback when the stored interval is unset/invalid. */
export const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 30

/** Lower form bound; also the floor after rounding a fractional interval. */
export const MIN_HEARTBEAT_INTERVAL_MINUTES = 1

/** Upper form bound (24h). */
export const MAX_HEARTBEAT_INTERVAL_MINUTES = 1440

/**
 * Normalize a stored or form-entered interval: unset/invalid (zero, negative,
 * non-finite) means "default", anything else clamps into [MIN, MAX]. Shared
 * so the renderer form and the main-side sync cannot diverge — a bare
 * Math.round could otherwise land on 0 (e.g. 0.4) and arm a 0ms trigger.
 */
export function clampHeartbeatIntervalMinutes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_HEARTBEAT_INTERVAL_MINUTES
  }
  return Math.min(Math.max(MIN_HEARTBEAT_INTERVAL_MINUTES, Math.round(raw)), MAX_HEARTBEAT_INTERVAL_MINUTES)
}
