/**
 * Request shaping for the OpenAI Codex provider (ChatGPT backend). Kept in its
 * own module — free of the electron/app import graph in `config.ts` — so the
 * body/header coercion can be unit-tested directly.
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

const INTEGER_FORM_FIELDS = new Set(['n', 'output_compression', 'partial_images', 'frame_count', 'frame_duration_ms'])

function codexRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function codexPathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function isCodexImageEditUrl(url: string): boolean {
  return codexPathname(url).endsWith('/images/edits')
}

/**
 * Codex `/images/edits` rejects multipart uploads. Turn the SDK file upload into
 * JSON `images` data URLs; the request URL stays `/images/edits`.
 */
export async function prepareCodexRequestBody(
  input: RequestInfo | URL,
  body: BodyInit | null | undefined
): Promise<BodyInit | null | undefined> {
  const url = codexRequestUrl(input)
  if (isCodexImageEditUrl(url)) return encodeCodexImageEditBody(body)
  // Image generation is already JSON and is not a Responses call.
  if (codexPathname(url).endsWith('/images/generations')) return body
  return coerceCodexRequestBody(body)
}

async function encodeCodexImageEditBody(body: BodyInit | null | undefined): Promise<BodyInit | null | undefined> {
  if (!(body instanceof FormData)) return body
  const images: { image_url: string }[] = []
  let mask: { image_url: string } | undefined
  const json: Record<string, unknown> = {}
  for (const [key, value] of body.entries()) {
    if (key === 'image' || key === 'image[]') {
      images.push({ image_url: await formValueToDataUrl(value) })
      continue
    }
    if (key === 'mask') {
      mask = { image_url: await formValueToDataUrl(value) }
      continue
    }
    if (typeof value !== 'string') continue
    json[key] = INTEGER_FORM_FIELDS.has(key) && /^-?\d+$/.test(value) ? Number(value) : value
  }
  if (images.length > 0) json.images = images
  if (mask) json.mask = mask
  return JSON.stringify(json)
}

async function formValueToDataUrl(value: FormDataEntryValue): Promise<string> {
  if (typeof value === 'string') return value
  const bytes = new Uint8Array(await value.arrayBuffer())
  const mediaType = value.type || 'application/octet-stream'
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
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

export function applyCodexFetchInit(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: BodyInit | null | undefined,
  creds: CodexCredentials
): RequestInit {
  const headers = buildCodexRequestHeaders(init?.headers, creds)
  if (isCodexImageEditUrl(codexRequestUrl(input)) && typeof body === 'string') {
    headers.set('content-type', 'application/json')
  }
  return { ...init, headers, body }
}
