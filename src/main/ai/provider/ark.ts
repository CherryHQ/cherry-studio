/**
 * `include` entries the OpenAI Responses adapter adds unconditionally but Ark
 * rejects with 400 `unknown type`. The adapter appends
 * `web_search_call.action.sources` whenever the `openai.web_search` provider
 * tool is present, so doubao's built-in search cannot ship without this strip.
 */
const ARK_UNSUPPORTED_INCLUDES = new Set(['web_search_call.action.sources'])

export function stripArkUnsupportedIncludes(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    const json = JSON.parse(body)
    if (!Array.isArray(json.include)) return body
    const include = json.include.filter((entry: unknown) => !ARK_UNSUPPORTED_INCLUDES.has(entry as string))
    if (include.length === json.include.length) return body
    return JSON.stringify({ ...json, include: include.length > 0 ? include : undefined })
  } catch {
    return body
  }
}
