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
const DEFAULT_CONTEXT_WINDOW = 200_000

/** Claude Code's local context budget (see the header): 200K by default, 1M under the `[1m]` suffix. */
export function effectiveContextWindowTokens(modelId: string | undefined): number {
  return modelId && /\[1m\]$/i.test(modelId) ? ONE_MILLION : DEFAULT_CONTEXT_WINDOW
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
