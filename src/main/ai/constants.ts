export const DEFAULT_TIMEOUT = 30 * 1000 * 60

export const DEFAULT_MAX_TOKENS = 8192

/**
 * Keep budget for context compaction, shared by both altitudes so they stay in
 * lockstep: turn-start durable compaction (PersistentChatContextProvider) and
 * the in-loop prepareStep hook (inLoopCompaction) keep this fraction of the
 * TRIGGER as recent verbatim turns.
 *
 * A fraction of the trigger, not of the window: the trigger is configurable
 * (`contextSettings.compress.thresholdPercent`), and a window-relative keep
 * budget would exceed the trigger below 30% — the turn-start lane would then
 * never find a boundary (`planKeepBoundary` returns null) while the in-loop
 * lane re-folded an already-folded prompt on every step. 0.375 keeps the
 * default 80% trigger at exactly the 0.3×window budget this replaces.
 */
export const CONTEXT_COMPACT_KEEP_BUDGET_OF_TRIGGER = 0.375

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
 * Share of the window the attachment budget may draw on after the output
 * reservation. The headroom absorbs provider protocol framing and estimator
 * error — the estimate is deliberately not a ledger.
 */
export const ATTACHMENT_INPUT_SAFETY_RATIO = 0.9

/**
 * Floor under `contextWindow − output reservation`. Catalogue data where
 * `maxOutputTokens` meets or exceeds `contextWindow` is common (83 registry
 * models), and an unfloored subtraction turns every window-relative budget
 * non-positive — the shape of #18318.
 */
export const MIN_INPUT_ROOM_RATIO = 0.2

/** Internal Claude Agent SDK → Cherry API Gateway bridge for Codex priority requests. */
export const CHERRY_FAST_MODE_HEADER = 'X-Cherry-Fast-Mode'
/** Process-local credential proving that a gateway request originated inside Cherry. */
export const CHERRY_INTERNAL_REQUEST_TOKEN_HEADER = 'X-Cherry-Internal-Request-Token'
