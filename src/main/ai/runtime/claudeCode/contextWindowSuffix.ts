/**
 * Claude Code budgets 200K of context locally unless the model id carries a `[1m]`
 * suffix, which it parses to raise the budget to 1e6 tokens (and add the
 * `context-1m-2025-08-07` beta) before stripping it from the outgoing API call. So
 * any Anthropic-compatible backend that actually serves ~1M context (DeepSeek
 * official, custom proxies) is mirrored into the suffix straight from the model's
 * declared `contextWindow`.
 *
 * Threshold is `>=` on purpose: the official DeepSeek `deepseek-chat` /
 * `deepseek-reasoner` models declare exactly 1,000,000.
 *
 * Skip the real Anthropic provider: Claude's own models also declare
 * `contextWindow: 1e6`, but its 1M is a gated/billed beta the Claude Code SDK
 * already negotiates per account — forcing `[1m]` there would opt every Claude
 * request into the 1M tier.
 *
 * @see https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code
 */

const ONE_MILLION = 1_000_000

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
