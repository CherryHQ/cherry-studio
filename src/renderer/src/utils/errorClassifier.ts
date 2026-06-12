import type { SerializedError } from '@renderer/types/error'

export interface ErrorClassification {
  category:
    | 'auth'
    | 'region'
    | 'model'
    | 'quota'
    | 'rate_limit'
    | 'context_length'
    | 'payload'
    | 'network'
    | 'proxy'
    | 'stream'
    | 'content'
    | 'server'
    | 'deprecated'
    | 'knowledge'
    | 'ocr'
    | 'mcp'
    | 'parse'
    | 'unknown'
  i18nKey: string
  navTarget: string | null
}

export function classifyError(error?: SerializedError, providerId?: string): ErrorClassification {
  if (!error) {
    return { category: 'unknown', i18nKey: 'error.diagnosis.unknown', navTarget: null }
  }

  const errorBag = error as Record<string, unknown>
  const status = errorBag.statusCode ?? errorBag.status
  const numStatus = typeof status === 'number' ? status : typeof status === 'string' ? parseInt(status, 10) : undefined
  const finishReason = String(errorBag.finishReason ?? '').toLowerCase()
  const providerSuffix = providerId ? `?id=${providerId}` : ''

  // SDK wrapper messages often hide the real error code; merge in responseBody and data
  // so structured signals like "insufficient_quota" inside responseBody can win over a generic
  // message like "Rate limit exceeded". Without this, the rule layer and the AI (which gets
  // these fields separately) would disagree on the category.
  const messageText = ((error.message as string) || '').toLowerCase()
  const responseBodyText = typeof errorBag.responseBody === 'string' ? errorBag.responseBody.toLowerCase() : ''
  let dataText = ''
  if (errorBag.data !== undefined && errorBag.data !== null) {
    try {
      dataText = (typeof errorBag.data === 'string' ? errorBag.data : JSON.stringify(errorBag.data)).toLowerCase()
    } catch {
      // ignore non-serializable data
    }
  }
  const msg = [messageText, responseBodyText, dataText].filter(Boolean).join('\n')

  // Structured safety signal — finishReason from NoObjectGeneratedError is the most reliable indicator
  if (finishReason === 'safety' || finishReason === 'recitation' || finishReason === 'content_filter') {
    return { category: 'content', i18nKey: 'error.diagnosis.content', navTarget: null }
  }

  // Geo / region block — must run BEFORE auth, since OpenAI returns 403 with
  // "unsupported_country_region_territory" and Anthropic blocks regions with 403.
  // Keywords are scoped to geographic phrases to avoid catching model-permission errors
  // like "model is not available in your account/plan".
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
    (msg.includes('territory') && (numStatus === 403 || msg.includes('unsupported')))
  ) {
    return { category: 'region', i18nKey: 'error.diagnosis.region', navTarget: '/settings/general' }
  }

  // Auth errors (401/403)
  if (
    numStatus === 401 ||
    numStatus === 403 ||
    msg.includes('invalid_api_key') ||
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden')
  ) {
    return { category: 'auth', i18nKey: 'error.diagnosis.auth', navTarget: `/settings/provider${providerSuffix}` }
  }

  // Model not found (404)
  if (
    numStatus === 404 ||
    msg.includes('model_not_found') ||
    msg.includes('model not found') ||
    msg.includes('model does not exist')
  ) {
    return { category: 'model', i18nKey: 'error.diagnosis.model', navTarget: `/settings/provider${providerSuffix}` }
  }

  // Quota / balance exhausted — check first so "429 + insufficient_balance" routes here, not to rate_limit.
  // HTTP 402 Payment Required is the canonical billing-failure status (used by several providers and gateways).
  if (
    numStatus === 402 ||
    msg.includes('quota') ||
    msg.includes('insufficient_balance') ||
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient_credit') ||
    msg.includes('billing') ||
    msg.includes('payment')
  ) {
    return { category: 'quota', i18nKey: 'error.diagnosis.quota', navTarget: `/settings/provider${providerSuffix}` }
  }

  // Rate limit (429 / "too many requests")
  if (
    numStatus === 429 ||
    msg.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return {
      category: 'rate_limit',
      i18nKey: 'error.diagnosis.rate_limit',
      navTarget: `/settings/provider${providerSuffix}`
    }
  }

  // Context length exceeded — Anthropic uses "prompt is too long", others vary
  if (
    msg.includes('context_length_exceeded') ||
    msg.includes('too many tokens') ||
    msg.includes('maximum context length') ||
    msg.includes('context window') ||
    msg.includes('prompt is too long') ||
    msg.includes('input is too long')
  ) {
    return { category: 'context_length', i18nKey: 'error.diagnosis.context_length', navTarget: null }
  }

  // Payload too large (413)
  if (numStatus === 413 || msg.includes('payload too large') || msg.includes('request entity too large')) {
    return { category: 'payload', i18nKey: 'error.diagnosis.payload', navTarget: null }
  }

  // Content filter — provider-agnostic safety blocks (no status restriction)
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
    return { category: 'content', i18nKey: 'error.diagnosis.content', navTarget: null }
  }

  // MCP errors — must run BEFORE network so "MCP timeout" / "MCP connection reset" route here
  if (
    msg.includes('mcp server') ||
    msg.includes('mcp connection') ||
    msg.includes('mcp error') ||
    msg.includes('mcp timeout') ||
    msg.includes('mcp transport') ||
    msg.includes('mcp client') ||
    msg.startsWith('mcp:') ||
    msg.startsWith('[mcp]') ||
    msg.includes('mcp_')
  ) {
    return { category: 'mcp', i18nKey: 'error.diagnosis.mcp', navTarget: '/settings/mcp/servers' }
  }

  // OCR errors — must run BEFORE network so "OCR timeout" routes here
  if (msg.includes('ocr') || msg.includes('recognition failed') || msg.includes('engine not initialized')) {
    return { category: 'ocr', i18nKey: 'error.diagnosis.ocr', navTarget: null }
  }

  // Stream interrupted — require specific transport-failure phrases, not bare "stream"
  if (
    msg.includes('econnreset') ||
    msg.includes('connection reset') ||
    msg.includes('stream interrupted') ||
    msg.includes('stream closed') ||
    msg.includes('stream aborted') ||
    msg.includes('stream ended unexpectedly') ||
    msg.includes('premature close')
  ) {
    return { category: 'stream', i18nKey: 'error.diagnosis.stream', navTarget: null }
  }

  // Network errors
  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('enotfound')
  ) {
    return { category: 'network', i18nKey: 'error.diagnosis.network', navTarget: '/settings/general' }
  }

  // Proxy / SSL certificate errors
  if (
    msg.includes('proxy') ||
    msg.includes('socks') ||
    msg.includes('certificate') ||
    msg.includes('self-signed') ||
    msg.includes('unable_to_verify_leaf_signature')
  ) {
    return { category: 'proxy', i18nKey: 'error.diagnosis.proxy', navTarget: '/settings/general' }
  }

  // Server errors (5xx / overloaded)
  if (numStatus === 529 || (numStatus && numStatus >= 500) || msg.includes('overloaded') || msg.includes('overload')) {
    return { category: 'server', i18nKey: 'error.diagnosis.server', navTarget: null }
  }

  // Model deprecated / retired — require co-occurrence with "model" to avoid matching
  // SDK warnings like "parameter X is deprecated"
  if (
    (msg.includes('deprecated') && msg.includes('model')) ||
    msg.includes('model has been retired') ||
    msg.includes('model is retired') ||
    msg.includes('model has been sunset') ||
    msg.includes('decommission')
  ) {
    return {
      category: 'deprecated',
      i18nKey: 'error.diagnosis.deprecated',
      navTarget: `/settings/provider${providerSuffix}`
    }
  }

  // Knowledge base / embedding
  if (msg.includes('embedding') || msg.includes('vectorize') || msg.includes('knowledge base')) {
    return { category: 'knowledge', i18nKey: 'error.diagnosis.knowledge', navTarget: '/knowledge' }
  }

  // Response parse errors — require specific parse-failure phrases, not bare "json"
  if (
    msg.includes('unexpected token') ||
    msg.includes('invalid response') ||
    msg.includes('parse error') ||
    msg.includes('failed to parse') ||
    msg.includes('json parse') ||
    msg.includes('invalid json') ||
    msg.includes('malformed json')
  ) {
    return { category: 'parse', i18nKey: 'error.diagnosis.parse', navTarget: null }
  }

  return { category: 'unknown', i18nKey: 'error.diagnosis.unknown', navTarget: null }
}
