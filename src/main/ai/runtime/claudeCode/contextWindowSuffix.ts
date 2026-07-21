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
