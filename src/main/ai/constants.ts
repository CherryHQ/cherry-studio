export const DEFAULT_TIMEOUT = 30 * 1000 * 60

export const DEFAULT_MAX_TOKENS = 8192

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

/**
 * In-flight tool-output trimming budget, as a share of the model's context
 * window. The persist lane keeps a plain character threshold (it protects DB
 * size and reload cost, which are window-independent), but the in-flight lane
 * protects the window itself, so a fixed character count is the wrong unit:
 * 100k chars is ~3% of a 1M window and several times a 16k one.
 */
export const IN_FLIGHT_TOOL_OUTPUT_WINDOW_RATIO = 0.1

/**
 * Chars-per-token used to convert a token window into the truncator's character
 * budget. Deliberately below the ~3.3–4 of English prose so the budget errs
 * small. Tool outputs are overwhelmingly code / JSON / logs / paths, so the
 * English-ish ratio is the right base case; CJK-heavy output (~0.67 chars per
 * token) therefore gets a larger token share than the nominal ratio implies —
 * accepted, since the explicit character setting still caps the top.
 */
export const APPROX_CHARS_PER_TOKEN = 3

/**
 * Never trim below this many characters: the truncator keeps head+tail
 * (500+1000) anyway, so a smaller budget would replace content with a marker of
 * comparable size for no gain.
 */
export const MIN_IN_FLIGHT_TRUNCATE_THRESHOLD = 2000

/**
 * Share of the model's context window the request's attachments may claim
 * inline. Attachments are explicit user intent — unlike tool output the user
 * asked for this content to be read — so the share is far larger than
 * IN_FLIGHT_TOOL_OUTPUT_WINDOW_RATIO.
 */
export const ATTACHMENT_INLINE_WINDOW_RATIO = 0.5

/**
 * Pessimistic chars-per-token for the attachment budget. NOT
 * APPROX_CHARS_PER_TOKEN (3): that one is tuned for code/JSON/log tool output
 * and is backstopped by the user's absolute character setting. The attachment
 * budget has no such backstop, and CJK prose runs ~1 token per character — at
 * 3 a Chinese document would claim ~3× its budgeted share and overflow the
 * window outright. Erring small only costs a read_file page; erring large
 * fails the request.
 */
export const ATTACHMENT_CHARS_PER_TOKEN = 1

/** Internal Claude Agent SDK → Cherry API Gateway bridge for Codex priority requests. */
export const CHERRY_FAST_MODE_HEADER = 'X-Cherry-Fast-Mode'
/** Process-local credential proving that a gateway request originated inside Cherry. */
export const CHERRY_INTERNAL_REQUEST_TOKEN_HEADER = 'X-Cherry-Internal-Request-Token'
