/**
 * `include` entries the OpenAI Responses adapter adds unconditionally but Ark
 * rejects with 400 `unknown type`. The adapter appends
 * `web_search_call.action.sources` whenever the `openai.web_search` provider
 * tool is present, so doubao's built-in search cannot ship without this strip.
 */
const ARK_UNSUPPORTED_INCLUDES = new Set(['web_search_call.action.sources'])

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isResponsesRequest(input: RequestInfo | URL): boolean {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(target).pathname.replace(/\/+$/, '').endsWith('/responses')
  } catch {
    return false
  }
}

function addMissingOutputTextAnnotations(value: unknown): unknown {
  if (!isJsonObject(value) || !Array.isArray(value.output)) return value

  let outputChanged = false
  const output = value.output.map((item) => {
    if (!isJsonObject(item) || item.type !== 'message' || !Array.isArray(item.content)) return item

    let contentChanged = false
    const content = item.content.map((part) => {
      if (
        !isJsonObject(part) ||
        part.type !== 'output_text' ||
        Object.prototype.hasOwnProperty.call(part, 'annotations')
      ) {
        return part
      }

      contentChanged = true
      return { ...part, annotations: [] }
    })

    if (!contentChanged) return item
    outputChanged = true
    return { ...item, content }
  })

  return outputChanged ? { ...value, output } : value
}

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

export async function normalizeArkResponsesResponse(input: RequestInfo | URL, response: Response): Promise<Response> {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (!response.ok || !isResponsesRequest(input) || contentType?.includes('text/event-stream')) return response

  try {
    const json: unknown = await response.clone().json()
    const normalized = addMissingOutputTextAnnotations(json)
    if (normalized === json) return response

    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')

    return new Response(JSON.stringify(normalized), {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  } catch {
    return response
  }
}
