/**
 * `include` entries the OpenAI Responses adapter adds unconditionally but Ark
 * rejects with 400 `unknown type`. The adapter appends
 * `web_search_call.action.sources` whenever the `openai.web_search` provider
 * tool is present, so doubao's built-in search cannot ship without this strip.
 */
const ARK_UNSUPPORTED_INCLUDES = new Set(['web_search_call.action.sources'])

/**
 * Ark accepts the OpenAI Responses request shape, but its history validator also
 * requires completed assistant messages to carry `status`. The OpenAI adapter
 * omits that field because it is optional in the OpenAI API.
 */
export function transformArkResponsesRequestBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    const json = JSON.parse(body)
    let changed = false

    if (Array.isArray(json.include)) {
      const include = json.include.filter((entry: unknown) => !ARK_UNSUPPORTED_INCLUDES.has(entry as string))
      if (include.length !== json.include.length) {
        json.include = include.length > 0 ? include : undefined
        changed = true
      }
    }

    if (Array.isArray(json.input)) {
      json.input = json.input.map((item: unknown) => {
        if (
          item &&
          typeof item === 'object' &&
          (item as { role?: unknown }).role === 'assistant' &&
          !('status' in item)
        ) {
          changed = true
          return { ...(item as Record<string, unknown>), status: 'completed' }
        }
        return item
      })
    }

    return changed ? JSON.stringify(json) : body
  } catch {
    return body
  }
}

/** Kept as a focused public helper for existing include-strip tests and callers. */
export function stripArkUnsupportedIncludes(body: BodyInit | null | undefined): BodyInit | null | undefined {
  return transformArkResponsesRequestBody(body)
}

function normalizeArkResponsesPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { output?: unknown }).output)) {
    return false
  }

  let changed = false
  for (const output of (payload as { output: unknown[] }).output) {
    if (!output || typeof output !== 'object' || (output as { type?: unknown }).type !== 'message') continue
    const content = (output as { content?: unknown }).content
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'output_text' &&
        (!('annotations' in part) || (part as { annotations?: unknown }).annotations == null)
      ) {
        const outputText = part as { annotations?: unknown[] }
        outputText.annotations = []
        changed = true
      }
    }
  }
  return changed
}

/**
 * Ark's successful Responses payload omits optional OpenAI fields that the SDK
 * schema currently treats as required. Only successful JSON responses are
 * normalized; errors and SSE streams pass through untouched for diagnostics and
 * streaming semantics.
 */
async function normalizeArkResponsesResponse(response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response

  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    return response
  }
  if (!normalizeArkResponsesPayload(payload)) return response

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

/** The provider-specific fetch seam used only by the built-in Ark Responses route. */
export function createArkResponsesFetch(innerFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await innerFetch(input, {
      ...init,
      body: transformArkResponsesRequestBody(init?.body)
    })
    return normalizeArkResponsesResponse(response)
  }
}
