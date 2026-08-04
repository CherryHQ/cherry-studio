export const DEFAULT_TIMEOUT = 30 * 1000 * 60

export const DEFAULT_MAX_TOKENS = 8192
export const MIN_TOOL_CALLS = 1
export const MAX_TOOL_CALLS = 100

/**
 * Context-compaction budget ratios, shared by both altitudes so their triggers
 * stay in lockstep: turn-start durable compaction (PersistentChatContextProvider)
 * and the in-loop prepareStep hook (inLoopCompaction). Recompact when the served
 * prompt exceeds TRIGGER×window; keep KEEP_BUDGET×window as recent verbatim turns.
 */
export const CONTEXT_COMPACT_TRIGGER_RATIO = 0.8
export const CONTEXT_COMPACT_KEEP_BUDGET_RATIO = 0.3

/**
 * Budget for the compaction request itself. Compaction protects the window, but
 * the summarize call is a window-bound request too: its input carries whole
 * tool outputs, so left un-budgeted it can overflow the compression model's
 * window and come back with no summary at all.
 *
 * Input budget = (window − output budget) × SAFETY_RATIO, floored at MIN so a
 * tiny window still sends something rather than stubbing everything away.
 */
export const COMPACTION_INPUT_SAFETY_RATIO = 0.85
export const COMPACTION_MIN_INPUT_BUDGET = 2000

/** Internal Claude Agent SDK → Cherry API Gateway bridge for Codex priority requests. */
export const CHERRY_FAST_MODE_HEADER = 'X-Cherry-Fast-Mode'
/** Process-local credential proving that a gateway request originated inside Cherry. */
export const CHERRY_INTERNAL_REQUEST_TOKEN_HEADER = 'X-Cherry-Internal-Request-Token'
