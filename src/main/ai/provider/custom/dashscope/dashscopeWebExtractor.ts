/**
 * DashScope's `web_extractor` server tool (help.aliyun.com/zh/model-studio/web-extractor) is a
 * Responses tool that fetches full page content. Two constraints shape delivery:
 *
 * 1. It must ride the `tools` array **alongside** `web_search` — the doc: "开启网页抓取必须同时开启
 *    联网搜索工具". It never works alone.
 * 2. `@ai-sdk/openai`'s Responses adapter silently drops any tool id outside its own allowlist, so
 *    `web_extractor` cannot be delivered through a provider-tool factory. It is appended to the
 *    serialized request body here instead (installed as a custom `fetch` in `config.ts`).
 *
 * Gate on `web_search` already being present in the body — the only signal available post-
 * serialization, and exactly the coupling the API requires. Bailian serves `web_extractor` only in
 * thinking mode: a request that disabled it (responses `reasoning.effort = "none"`, chat
 * `enable_thinking = false`) is rejected, so keep `web_search` only. Otherwise append the extractor
 * as-is — thinking on the Responses endpoint is governed by `reasoning.effort` alone (verified
 * live: `enable_thinking` neither enables the extractor under `effort=none` nor is required when
 * `effort` is present or absent).
 */
export function appendDashScopeWebExtractor(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    if (!Array.isArray(json.tools)) return body
    const tools = json.tools as Array<{ type?: string }>
    const hasTool = (type: string) => tools.some((tool) => tool?.type === type)
    if (!hasTool('web_search') || hasTool('web_extractor')) return body
    // web_extractor requires thinking; a request that disabled it must keep web_search only.
    if (isThinkingDisabled(json)) return body
    return JSON.stringify({
      ...json,
      tools: [...tools, { type: 'web_extractor' }]
    })
  } catch {
    return body
  }
}

/** Whether the request explicitly turned thinking off (responses `reasoning.effort` / chat `enable_thinking`). */
function isThinkingDisabled(body: Record<string, unknown>): boolean {
  if (body.enable_thinking === false) return true
  return (body.reasoning as { effort?: unknown } | undefined)?.effort === 'none'
}
