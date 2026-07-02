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
