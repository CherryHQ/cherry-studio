/**
 * Claude Code budgets 200K of context locally unless the model id carries a `[1m]`
 * suffix, which it parses to raise the budget to 1e6 tokens before stripping it
 * from the outgoing API call. So any Anthropic-compatible backend that actually
 * serves ~1M context (DeepSeek official, custom proxies) is mirrored into the
 * suffix straight from the model's declared `contextWindow`.
 *
 * Threshold is `>=` on purpose: the official DeepSeek `deepseek-chat` /
 * `deepseek-reasoner` models declare exactly 1,000,000.
 *
 * The first-party Anthropic endpoint is skipped: Claude Code manages first-party
 * model capabilities (including their context window) itself, so we must not
 * second-guess it by forcing the suffix. "First-party" is decided by the resolved
 * host, NOT the provider's preset origin — a provider copied from the Anthropic
 * preset but repointed at a custom 1M proxy is not first-party and still needs it.
 * First-party 1M is a user choice instead: the catalog serves the suffixed ids as
 * their own models (see `provider-registry/src/providers/claude-code.ts`), because
 * on a subscription the Opus 1M window can cost usage credits.
 *
 * @see https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code
 */

const ONE_MILLION = 1_000_000
const ANTHROPIC_OFFICIAL_HOST = 'api.anthropic.com'

/**
 * True for the first-party Anthropic endpoint: an explicit `api.anthropic.com`
 * host, or an unset base URL (the Claude Code SDK then defaults to it).
 */
export function isAnthropicOfficialHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return true
  try {
    return new URL(baseUrl).hostname === ANTHROPIC_OFFICIAL_HOST
  } catch {
    return false
  }
}

export function with1mSuffix(
  modelId: string | undefined,
  contextWindow: number | undefined,
  isAnthropicNative: boolean
): string {
  if (!modelId) return ''
  if (isAnthropicNative) return modelId
  if (/\[1m\]$/i.test(modelId)) return modelId
  if (!contextWindow || contextWindow < ONE_MILLION) return modelId
  return `${modelId}[1m]`
}

/**
 * Parse a trailing context-window annotation a user baked into a model id — `[1m]`, `[128k]`,
 * `[200k]`, `[1.5m]` — into a token count. Returns `undefined` when the id has no such suffix, so a
 * caller can use it as a `??` fallback for a custom row whose `contextWindow` never resolved (the row
 * failed to match a preset because the suffix defeated `normalizeModelId`, so the registry value was
 * never merged in). Case-insensitive (`[1M]` matches Code Mate's spelling). Trailing-anchored so a
 * mid-id bracket is not misread.
 */
export function parseContextWindowSuffix(modelId: string | undefined): number | undefined {
  if (!modelId) return undefined
  const match = modelId.match(/\[(\d+(?:\.\d+)?)([km])\]$/i)
  if (!match) return undefined
  const value = Number(match[1])
  return match[2].toLowerCase() === 'm' ? value * ONE_MILLION : value * 1000
}

/**
 * Resolve the context window to pass to the Claude Code SDK for an Agent session.
 *
 * A custom row never merges the registry's `contextWindow` on read, so a row that failed to match a
 * preset arrives with `rowContextWindow === undefined`. Fall back, in order:
 *   1. the registry preset's window — covers a plain id that just missed the preset match;
 *   2. a `[1m]`/`[128k]` annotation in the id — covers a suffixed id the preset can never match
 *      (normalizeModelId won't strip the bracket).
 * Preset-backed rows already carry a precise merged value, so step 1 short-circuits before any
 * fallback runs.
 */
export function resolveAgentContextWindow(
  rowContextWindow: number | undefined,
  presetContextWindow: number | undefined,
  modelId: string | undefined
): number | undefined {
  return rowContextWindow ?? presetContextWindow ?? parseContextWindowSuffix(modelId)
}
