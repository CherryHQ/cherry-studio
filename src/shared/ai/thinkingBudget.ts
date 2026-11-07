/**
 * Bailian / QwenCloud `thinking_budget` rejection handling (#21906).
 *
 * The Chat Completions `thinking_budget` ceilings differ per Qwen SKU family
 * (81920 for qwen3.5 lines, 131072 for qwen3.6 plus/flash lines, unsupported
 * entirely for SKUs like `qwen3.5-ocr`). When a request still reaches the
 * provider with an out-of-range value, Bailian fails the turn outright:
 *
 *   `400 InternalError.Algo.InvalidParameter: The thinking_budget parameter
 *    must be a positive integer and not greater than 81920`
 *
 * This module is the shared vocabulary for that failure: a matcher, a
 * ceiling parser, pure providerOptions transforms (clamp / strip), and the
 * actionable user-facing hint. The preventive clamp lives in
 * `resolveModeBudget`; the in-place retry lives in the ai-retry
 * `thinkingBudgetDegradeRetryable`; the hint is appended in `serializeError`
 * and the API-gateway error envelopes.
 */
import { RetryError } from 'ai'

const THINKING_BUDGET_PATTERN = /thinking_budget/i
const INVALID_PARAMETER_PATTERN = /invalidparameter|invalid_parameter/i
const BAD_REQUEST_PATTERN = /\b400\b/
const CEILING_PATTERN = /not greater than (\d+)/i

/** Actionable suffix appended when a `thinking_budget` rejection is surfaced. */
export const THINKING_BUDGET_HINT =
  'Cherry Studio reasoning setting: the thinking budget sent for this model was rejected by the provider. ' +
  'Lower the reasoning effort (or turn reasoning off for models without thinking support) and retry.'

function errorTextCandidates(error: unknown, depth = 0): string[] {
  if (depth > 3 || error === null || typeof error !== 'object') return []
  const source = error as {
    message?: unknown
    responseBody?: unknown
    data?: unknown
    error?: unknown
    cause?: unknown
    lastError?: unknown
  }
  const texts: string[] = []
  for (const candidate of [source.message, source.responseBody, source.data]) {
    if (typeof candidate === 'string' && candidate) texts.push(candidate)
  }
  // OpenAI/APIError envelope shape (`{ status, error: { message } }`), which
  // the gateway's `extractError` prefers over the top-level `message`.
  if (isPlainRecord(source.error) && typeof source.error.message === 'string' && source.error.message) {
    texts.push(source.error.message)
  }
  texts.push(...errorTextCandidates(source.cause, depth + 1))
  texts.push(...errorTextCandidates(source.lastError, depth + 1))
  return texts
}

function errorStatus(error: unknown): number | undefined {
  const source = error as { status?: unknown; statusCode?: unknown } | null
  if (source && typeof source === 'object') {
    if (typeof source.status === 'number') return source.status
    if (typeof source.statusCode === 'number') return source.statusCode
  }
  return undefined
}

/**
 * Whether this failure is a provider `thinking_budget` parameter rejection:
 * the text names the parameter and carries a bad-request signal (HTTP 400 or
 * an InvalidParameter marker). Reads `message` / `responseBody` / `data` /
 * the `error.message` envelope shape, and follows `cause` / `lastError`
 * (RetryError) nesting.
 */
export function isThinkingBudgetRejection(error: unknown): boolean {
  const unwrapped = RetryError.isInstance(error) ? error.lastError : error
  const texts = errorTextCandidates(unwrapped)
  if (!texts.some((text) => THINKING_BUDGET_PATTERN.test(text))) return false
  const status = errorStatus(unwrapped)
  if (status !== undefined) return status === 400
  return texts.some((text) => INVALID_PARAMETER_PATTERN.test(text) || BAD_REQUEST_PATTERN.test(text))
}

/**
 * First error text naming `thinking_budget`, following `cause` / `lastError`
 * (RetryError) nesting. Used to surface the provider's own wording when the
 * top-level message is generic. `undefined` when no text names the parameter.
 */
export function thinkingBudgetRejectionText(error: unknown): string | undefined {
  const unwrapped = RetryError.isInstance(error) ? error.lastError : error
  return errorTextCandidates(unwrapped).find((text) => THINKING_BUDGET_PATTERN.test(text))
}

/**
 * Parse the provider-enforced ceiling from the rejection text
 * ("not greater than 81920" → 81920). `undefined` when unparseable.
 */
export function parseThinkingBudgetCeiling(error: unknown): number | undefined {
  const unwrapped = RetryError.isInstance(error) ? error.lastError : error
  for (const text of errorTextCandidates(unwrapped)) {
    const match = CEILING_PATTERN.exec(text)
    if (match) {
      const ceiling = Number.parseInt(match[1], 10)
      if (Number.isSafeInteger(ceiling) && ceiling >= 0) return ceiling
    }
  }
  return undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function transformBudgetLeaves(
  value: unknown,
  transform: (budget: number) => number | undefined
): { transformed: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((entry) => {
      const nested = transformBudgetLeaves(entry, transform)
      if (nested.changed) changed = true
      return nested.transformed
    })
    return { transformed: changed ? next : value, changed }
  }
  if (!isPlainRecord(value)) return { transformed: value, changed: false }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'thinking_budget' && typeof entry === 'number') {
      const replacement = transform(entry)
      if (replacement === undefined) {
        changed = true
        continue
      }
      if (replacement !== entry) changed = true
      next[key] = replacement
      continue
    }
    if (isPlainRecord(entry) || Array.isArray(entry)) {
      const nested = transformBudgetLeaves(entry, transform)
      if (nested.changed) changed = true
      next[key] = nested.transformed
      continue
    }
    next[key] = entry
  }
  return { transformed: changed ? next : value, changed }
}

/**
 * Clamp every `thinking_budget` leaf to `ceiling`. Returns the original
 * reference untouched when nothing changed (no leaf, or all within range).
 */
export function clampThinkingBudget(
  providerOptions: unknown,
  ceiling: number
): { providerOptions: unknown; changed: boolean } {
  const { transformed, changed } = transformBudgetLeaves(providerOptions, (budget) => Math.min(budget, ceiling))
  return { providerOptions: transformed, changed }
}

/**
 * Drop every `thinking_budget` leaf, keeping `enable_thinking` (or any other
 * reasoning field) intact. Returns the original reference untouched when no
 * leaf was present.
 */
export function stripThinkingBudget(providerOptions: unknown): { providerOptions: unknown; changed: boolean } {
  const { transformed, changed } = transformBudgetLeaves(providerOptions, () => undefined)
  return { providerOptions: transformed, changed }
}

/** Whether any `thinking_budget` leaf is present (used to avoid no-op retries). */
export function hasThinkingBudget(providerOptions: unknown): boolean {
  if (Array.isArray(providerOptions)) return providerOptions.some(hasThinkingBudget)
  if (!isPlainRecord(providerOptions)) return false
  return Object.entries(providerOptions).some(([key, entry]) => {
    if (key === 'thinking_budget' && typeof entry === 'number') return true
    return hasThinkingBudget(entry)
  })
}

/** Append the actionable hint. Idempotent; callers must have established the rejection first. */
export function appendThinkingBudgetHint(message: string): string {
  return message.includes(THINKING_BUDGET_HINT) ? message : `${message} ${THINKING_BUDGET_HINT}`
}
