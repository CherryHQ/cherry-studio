/**
 * BigModel's built-in web search is a `tools`-array entry
 * (`{type:'web_search', web_search:{...}}`), which the openai-compatible wire
 * cannot express: provider-defined tool types are dropped by `prepareTools`,
 * and a providerOptions `tools` key is clobbered by the SDK's own tools field.
 * `getWebSearchParams` therefore emits a `web_search` body marker via
 * providerOptions, and this request-body transform moves it into `tools`,
 * preserving any function tools already present.
 */
export function transformZhipuRequestBody(args: Record<string, any>): Record<string, any> {
  const { web_search: webSearch, ...rest } = args
  if (!webSearch || typeof webSearch !== 'object') return args

  return { ...rest, tools: [...(rest.tools ?? []), { type: 'web_search', web_search: webSearch }] }
}
