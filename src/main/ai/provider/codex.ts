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
 * Coerce the OpenAI Responses request body into the shape the ChatGPT codex
 * backend requires: server-side `store` is rejected, and with it off the
 * encrypted reasoning must be included so it round-trips across turns. Bodies
 * that are not JSON strings (shouldn't happen for responses) pass through
 * untouched.
 */
export function coerceCodexRequestBody(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body
  try {
    const json = JSON.parse(body)
    json.store = false
    const include = new Set<string>(Array.isArray(json.include) ? json.include : [])
    include.add(CODEX_REASONING_INCLUDE)
    json.include = [...include]
    return JSON.stringify(json)
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
