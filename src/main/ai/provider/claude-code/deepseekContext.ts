/**
 * DeepSeek V4+ "pro" models on api.deepseek.com support a 1M context window,
 * but Claude Code only knows about it via the `[1m]` model-id suffix (parsed
 * locally to switch context budgeting to 1e6 tokens, then stripped before the
 * API call). DeepSeek's official Claude Code integration docs recommend
 * appending it; gating on the official host keeps third-party DeepSeek
 * deployments (OpenRouter / Fireworks / etc.) from claiming a capacity their
 * backend may not actually serve.
 *
 * Ported from the pre-v2 `claudecode/utils.ts` (#14965) into the v2
 * claude-code provider path.
 * @see https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code
 */

const DEEPSEEK_V4_PLUS_PRO_REGEX = /(\w+-)?deepseek-v([4-9]|\d{2,})([.-]\w+)*$/i

export function isDeepSeekOfficialHost(host: string | undefined): boolean {
  const trimmed = host?.trim()
  if (!trimmed) return false
  try {
    return new URL(trimmed).hostname.endsWith('api.deepseek.com')
  } catch {
    return false
  }
}

export function withDeepSeek1mSuffix(modelId: string | undefined, anthropicHost: string | undefined): string {
  if (!modelId) return ''
  if (!isDeepSeekOfficialHost(anthropicHost)) return modelId
  if (/\[1m\]$/i.test(modelId)) return modelId
  if (/flash/i.test(modelId)) return modelId
  if (!DEEPSEEK_V4_PLUS_PRO_REGEX.test(modelId)) return modelId
  return `${modelId}[1m]`
}
