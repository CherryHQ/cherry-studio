export const DEFAULT_TIMEOUT = 30 * 1000 * 60

export const DEFAULT_MAX_TOKENS = 8192
export const MIN_TOOL_CALLS = 1
export const MAX_TOOL_CALLS = 100

/** Internal Claude Agent SDK → Cherry API Gateway bridge for Codex priority requests. */
export const CHERRY_FAST_MODE_HEADER = 'X-Cherry-Fast-Mode'
