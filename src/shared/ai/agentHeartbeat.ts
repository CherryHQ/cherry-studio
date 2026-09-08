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

/** Run timeout for an agent task turn (heartbeat and user tasks alike). */
export const DEFAULT_AGENT_TASK_TIMEOUT_MINUTES = 2
