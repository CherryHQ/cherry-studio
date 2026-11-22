interface ZhipuRequestBody {
  tools?: unknown[] | null
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Preserve pre-serialization provider fields and arbitrary tool-schema values without interpreting them.
  [key: string]: unknown
}

/**
 * BigModel's built-in web search is a `tools`-array entry
 * (`{type:'web_search', web_search:{...}}`), which the openai-compatible wire
 * cannot express: provider-defined tool types are dropped by `prepareTools`,
 * and a providerOptions `tools` key is clobbered by the SDK's own tools field.
 * `getWebSearchParams` therefore emits a `web_search` body marker via
 * providerOptions, and this request-body transform moves it into `tools`,
 * preserving any function tools already present.
 */
export function transformZhipuRequestBody(args: ZhipuRequestBody): ZhipuRequestBody {
  const { web_search: webSearch, ...rest } = args
  if (!webSearch || typeof webSearch !== 'object') return args

  return { ...rest, tools: [...(rest.tools ?? []), { type: 'web_search', web_search: webSearch }] }
}
