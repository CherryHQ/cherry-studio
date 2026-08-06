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
 * serialization, and exactly the coupling the API requires. Also force `enable_thinking: true`, which
 * web_extractor requires but the Responses reasoning wire (which emits `reasoning.effort`) does not send.
 */
export function appendDashScopeWebExtractor(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    const json = JSON.parse(body)
    if (!Array.isArray(json.tools)) return body
    const hasTool = (type: string) => json.tools.some((tool: unknown) => (tool as { type?: string })?.type === type)
    if (!hasTool('web_search') || hasTool('web_extractor')) return body
    return JSON.stringify({
      ...json,
      tools: [...json.tools, { type: 'web_extractor' }],
      enable_thinking: true
    })
  } catch {
    return body
  }
}
