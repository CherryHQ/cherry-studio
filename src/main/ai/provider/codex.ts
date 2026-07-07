/**
 * Request shaping for the OpenAI Codex provider (ChatGPT backend codex
 * responses endpoint). Kept in its own module — free of the electron/app import
 * graph in `config.ts` — so the body/header coercion can be unit-tested
 * directly.
 */

const CODEX_REASONING_INCLUDE = 'reasoning.encrypted_content'

export interface CodexCredentials {
  accessToken: string
  accountId: string | null
}

/**
 * Rewrite a parsed OpenAI Responses payload (mutated in place and returned) into
 * the shape the ChatGPT codex backend requires: server-side `store` is rejected,
 * response length caps are not accepted, and encrypted reasoning must round-trip.
 */
export function coerceCodexRequestJson(json: Record<string, any>): Record<string, any> {
  json.store = false
  delete json.max_output_tokens
  const include = new Set<string>(Array.isArray(json.include) ? json.include : [])
  include.add(CODEX_REASONING_INCLUDE)
  json.include = [...include]
  return json
}

/**
 * Coerce a serialized Responses body via {@link coerceCodexRequestJson}.
 * Non-JSON bodies pass through untouched.
 */
export function coerceCodexRequestBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    return JSON.stringify(coerceCodexRequestJson(JSON.parse(body)))
  } catch {
    return body
  }
}

/**
 * Build the request headers for a codex call: the OAuth bearer token plus the
 * ChatGPT account id and the codex-specific beta/originator markers, layered
 * over whatever the SDK already set.
 */
export function buildCodexRequestHeaders(base: HeadersInit | undefined, creds: CodexCredentials): Headers {
  const headers = new Headers(base)
  headers.set('Authorization', `Bearer ${creds.accessToken}`)
  if (creds.accountId) headers.set('chatgpt-account-id', creds.accountId)
  headers.set('OpenAI-Beta', 'responses=experimental')
  headers.set('originator', 'cherry-studio')
  return headers
}
