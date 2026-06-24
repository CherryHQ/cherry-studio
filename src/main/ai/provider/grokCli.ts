/**
 * Request shaping for the Grok CLI provider (xAI's `cli-chat-proxy.grok.com`
 * Responses endpoint). Kept in its own module — free of the electron/app import
 * graph in `config.ts` — so the body/header coercion can be unit-tested
 * directly.
 *
 * xAI's proxy speaks the OpenAI Responses surface but with stricter edges than
 * the generic adapter emits: it wants `system`/`developer` turns hoisted into
 * top-level `instructions`, rejects replayed `reasoning` items, and does not
 * implement a few OpenAI-only knobs. The pi-xai-oauth extension solves the same
 * path the same way.
 */

const GROK_CLIENT_VERSION = '0.2.16'

export interface GrokCliCredentials {
  accessToken: string
  /** The request's model id, sent back as the `x-grok-model-override` header. */
  modelId: string
}

/** `grok-cli/grok-build` → `grok-build`; lower-cases and drops any provider prefix. */
export function normalizeGrokModelId(modelId: string): string {
  return (modelId || '').toLowerCase().split('/').pop() || ''
}

function textFromResponsesContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
        return (part as Record<string, string>).text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Rewrite a generic OpenAI Responses payload (parsed object, mutated in place
 * and returned) into the shape xAI's Grok CLI proxy accepts.
 */
export function rewriteGrokCliResponsesBody(json: Record<string, any>): Record<string, any> {
  if (Array.isArray(json.input)) {
    const instructionParts: string[] = []
    json.input = json.input.filter((item: Record<string, any>) => {
      if (!item || typeof item !== 'object') return true
      // The proxy rejects replayed reasoning items and empty-content turns.
      if (item.type === 'reasoning') return false
      if (typeof item.content === 'string' && item.content.length === 0) return false
      if (item.role !== 'developer' && item.role !== 'system') return true
      const text = textFromResponsesContent(item.content).trim()
      if (text) instructionParts.push(text)
      return false
    })
    if (instructionParts.length > 0) {
      json.instructions = [json.instructions, ...instructionParts]
        .filter((part) => typeof part === 'string' && part)
        .join('\n\n')
    }
  }

  if (json.response_format && !json.text) {
    json.text = { format: json.response_format }
    delete json.response_format
  }

  // grok-build / grok-composer-2.5-fast don't accept an explicit Responses
  // reasoning effort; sending one 422s, so drop the reasoning knob entirely.
  delete json.reasoning

  if (Array.isArray(json.include)) {
    json.include = json.include.filter((item: unknown) => item !== 'reasoning.encrypted_content')
    if (json.include.length === 0) delete json.include
  }

  // xAI's proxy doesn't implement OpenAI's prompt_cache_retention knob.
  delete json.prompt_cache_retention

  return json
}

/** Coerce the raw request body string into the Grok-CLI-compatible payload. */
export function coerceGrokCliRequestBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    return JSON.stringify(rewriteGrokCliResponsesBody(JSON.parse(body)))
  } catch {
    return body
  }
}

/**
 * Build the request headers for a Grok CLI proxy call: the OAuth bearer token
 * plus the Grok-CLI client markers the proxy authenticates against, layered
 * over whatever the SDK already set.
 */
export function buildGrokCliRequestHeaders(base: HeadersInit | undefined, creds: GrokCliCredentials): Headers {
  const headers = new Headers(base)
  headers.set('Authorization', `Bearer ${creds.accessToken}`)
  headers.set('x-grok-client-identifier', 'cherry-studio')
  headers.set('x-grok-client-version', GROK_CLIENT_VERSION)
  headers.set('x-xai-token-auth', 'xai-grok-cli')
  const modelOverride = normalizeGrokModelId(creds.modelId)
  if (modelOverride) headers.set('x-grok-model-override', modelOverride)
  return headers
}
