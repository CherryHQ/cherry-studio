// Single source of error-text recognition. Main classifies subprocess stderr, the renderer
// classifies provider responses; both must agree on precedence (region before 403, quota
// before 429, feature timeouts before generic network).

export const ERROR_CATEGORIES = [
  'auth',
  'permission',
  'region',
  'model',
  'quota',
  'rate_limit',
  'context_length',
  'payload',
  'network',
  'proxy',
  'stream',
  'content',
  'server',
  'deprecated',
  'knowledge',
  'ocr',
  'mcp',
  'parse',
  'unknown'
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

const CATEGORY_NAMES: ReadonlySet<string> = new Set(ERROR_CATEGORIES)

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === 'string' && CATEGORY_NAMES.has(value)
}

/**
 * Recover an HTTP status from free text. Only for sources without a structured status
 * (CLI stderr); callers holding a real status field must pass that instead.
 */
export function extractHttpStatus(text: string): number | undefined {
  const match = /\b([45]\d\d)\b/.exec(text)
  return match ? Number(match[1]) : undefined
}

export function isQuotaErrorMessage(message: string): boolean {
  const msg = message.toLowerCase()

  return (
    msg.includes('quota') ||
    msg.includes('insufficient_balance') ||
    msg.includes('insufficient balance') ||
    msg.includes('insufficient_credit') ||
    msg.includes('insufficient credit') ||
    msg.includes('billing') ||
    msg.includes('payment')
  )
}

export function isMcpErrorMessage(message: string): boolean {
  const msg = message.toLowerCase()

  return (
    msg.includes('mcp server') ||
    msg.includes('mcp connection') ||
    msg.includes('mcp error') ||
    msg.includes('mcp timeout') ||
    msg.includes('mcp transport') ||
    msg.includes('mcp client') ||
    msg.startsWith('mcp:') ||
    msg.startsWith('[mcp]') ||
    msg.includes('mcp_')
  )
}

export function isProxyErrorMessage(message: string): boolean {
  const msg = message.toLowerCase()
  // A failed proxy tunnel carries no `proxy` token (Chromium `ERR_TUNNEL_CONNECTION_FAILED`).
  if (msg.includes('err_tunnel_connection_failed')) {
    return true
  }
  // Underscore→space would split ERR_MANDATORY_PROXY_* into "err mandatory proxy".
  if (/\berr(?:_[a-z0-9]+)*_proxy(?:_[a-z0-9]+)*\b/.test(msg)) {
    return true
  }

  const normalized = msg.replace(/_/g, ' ')

  return (
    normalized.includes('err proxy') ||
    normalized.includes('proxy connection') ||
    normalized.includes('proxy response') ||
    normalized.includes('proxy error') ||
    normalized.includes('proxy refused') ||
    normalized.includes('proxy rejected') ||
    normalized.includes('connection to proxies')
  )
}

export interface ErrorCategoryInput {
  /** Message, response body and provider data joined; case-insensitive. */
  text?: string
  status?: number
  finishReason?: string
}

export function classifyErrorCategory({ text, status, finishReason }: ErrorCategoryInput): ErrorCategory {
  switch (finishReason?.toLowerCase()) {
    case 'content-filter':
    case 'content_filter':
    case 'safety':
    case 'recitation':
      return 'content'
  }

  const msg = (text ?? '').toLowerCase()

  // Geo-block responses often use HTTP 403, so region signals must win over auth.
  if (
    msg.includes('unsupported_country') ||
    msg.includes('country, region') ||
    msg.includes('country/region') ||
    msg.includes('region not supported') ||
    msg.includes('not available in your region') ||
    msg.includes('not available in your country') ||
    msg.includes('not available in your location') ||
    msg.includes('not available in your area') ||
    msg.includes('not available in your territory') ||
    (msg.includes('territory') && (status === 403 || msg.includes('unsupported')))
  ) {
    return 'region'
  }

  // Auth errors (401). 403 is handled below: a refused request is often unrelated to key
  // validity, so claiming the key is invalid sends users off regenerating working keys.
  if (
    status === 401 ||
    msg.includes('invalid_api_key') ||
    msg.includes('invalid api key') ||
    msg.includes('api key is invalid') ||
    msg.includes('incorrect api key') ||
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('unauthorised') ||
    msg.includes('not logged in')
  ) {
    return 'auth'
  }

  // Model not found (404)
  if (
    status === 404 ||
    msg.includes('model_not_found') ||
    /model\b.{0,80}(?:not found|does not exist|unavailable|no access)/.test(msg)
  ) {
    return 'model'
  }

  // Explicit billing signals win over the HTTP 429 rate-limit default.
  if (status === 402 || isQuotaErrorMessage(msg)) {
    return 'quota'
  }

  // 403 = the request was refused, cause unspecified. Kept below region/model/quota because
  // those more specific causes also ship as 403.
  if (status === 403 || msg.includes('forbidden')) {
    return 'permission'
  }

  // Rate limit (429 / "too many requests")
  if (status === 429 || /rate[_ -]?limit/.test(msg) || msg.includes('too many requests')) {
    return 'rate_limit'
  }

  // Context length exceeded
  if (
    msg.includes('context_length_exceeded') ||
    msg.includes('too many tokens') ||
    msg.includes('maximum context length') ||
    msg.includes('context window') ||
    msg.includes('prompt is too long') ||
    msg.includes('input is too long')
  ) {
    return 'context_length'
  }

  // Payload too large (413)
  if (status === 413 || msg.includes('payload too large') || msg.includes('request entity too large')) {
    return 'payload'
  }

  // Content filter signals are provider-specific and do not consistently use HTTP 400.
  if (
    msg.includes('content_filter') ||
    msg.includes('content_policy') ||
    msg.includes('content_policy_violation') ||
    msg.includes('safety') ||
    msg.includes('prohibited_content') ||
    msg.includes('responsible_ai') ||
    msg.includes('output_blocked') ||
    msg.includes('finishreason: safety') ||
    msg.includes('"safety"') ||
    msg.includes('recitation') ||
    msg.includes('blocked by safety')
  ) {
    return 'content'
  }

  // Feature-specific timeouts must win over generic network classification.
  if (isMcpErrorMessage(msg)) {
    return 'mcp'
  }

  if (msg.includes('ocr') || msg.includes('recognition failed') || msg.includes('engine not initialized')) {
    return 'ocr'
  }

  // Require a transport-failure phrase instead of matching every mention of streaming.
  // Chromium codes use underscores, so they never match the space phrases above.
  // `ERR_CONNECTION_ABORTED` is intentionally not here: an aborted connection is a
  // `network` transport failure, classified with the timeout/failure codes below.
  if (
    msg.includes('econnreset') ||
    msg.includes('connection reset') ||
    msg.includes('err_connection_reset') ||
    msg.includes('err_connection_closed') ||
    msg.includes('stream interrupted') ||
    msg.includes('stream closed') ||
    msg.includes('stream aborted') ||
    msg.includes('stream ended unexpectedly') ||
    msg.includes('premature close')
  ) {
    return 'stream'
  }

  // Network errors. Chromium `net::ERR_*` codes use underscores, matching the
  // anchors the diagnostics scanner already recognizes (see network.ts).
  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('enotfound') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_name_resolution_failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_network_changed') ||
    msg.includes('err_address_unreachable') ||
    msg.includes('enetunreach') ||
    msg.includes('ehostunreach') ||
    msg.includes('eai_again') ||
    msg.includes('err_connection_refused') ||
    msg.includes('err_connection_timed_out') ||
    msg.includes('err_connection_aborted') ||
    msg.includes('err_timed_out')
  ) {
    return 'network'
  }

  // Proxy / SSL certificate errors
  if (
    msg.includes('err_ssl_client_auth_cert_needed') ||
    isProxyErrorMessage(msg) ||
    msg.includes('socks') ||
    msg.includes('certificate') ||
    msg.includes('self-signed') ||
    msg.includes('unable_to_verify_leaf_signature')
  ) {
    return 'proxy'
  }

  // Server errors (5xx / overloaded)
  if (
    status === 529 ||
    (status !== undefined && status >= 500) ||
    msg.includes('overloaded') ||
    msg.includes('overload') ||
    msg.includes('service unavailable') ||
    msg.includes('internal server error')
  ) {
    return 'server'
  }

  // Require a model-specific phrase so deprecated parameters do not look like retired models.
  if (
    (msg.includes('deprecated') && msg.includes('model')) ||
    msg.includes('model has been retired') ||
    msg.includes('model is retired') ||
    msg.includes('model has been sunset') ||
    msg.includes('decommission')
  ) {
    return 'deprecated'
  }

  // Knowledge base / embedding
  if (msg.includes('embedding') || msg.includes('vectorize') || msg.includes('knowledge base')) {
    return 'knowledge'
  }

  // Response parse errors
  if (
    msg.includes('unexpected token') ||
    msg.includes('invalid response') ||
    msg.includes('parse error') ||
    msg.includes('failed to parse') ||
    msg.includes('json parse') ||
    msg.includes('invalid json') ||
    msg.includes('malformed json')
  ) {
    return 'parse'
  }

  return 'unknown'
}
