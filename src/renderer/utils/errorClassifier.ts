import type { SerializedError } from '@renderer/types/error'

export interface ErrorClassification {
  category:
    | 'auth'
    | 'model'
    | 'quota'
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

  const status = (error as Record<string, unknown>).statusCode ?? (error as Record<string, unknown>).status
  const numStatus = typeof status === 'number' ? status : typeof status === 'string' ? parseInt(status, 10) : undefined
  const msg = ((error.message as string) || '').toLowerCase()
  const providerSuffix = providerId ? `?id=${providerId}` : ''

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

  // Quota / rate limit (429)
  if (
    numStatus === 429 ||
    msg.includes('quota') ||
    msg.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('insufficient_balance') ||
    msg.includes('insufficient_quota')
  ) {
    return { category: 'quota', i18nKey: 'error.diagnosis.quota', navTarget: `/settings/provider${providerSuffix}` }
  }

  // Context length exceeded
  if (
    msg.includes('context_length_exceeded') ||
    msg.includes('too many tokens') ||
    msg.includes('maximum context length')
  ) {
    return { category: 'context_length', i18nKey: 'error.diagnosis.context_length', navTarget: null }
  }

  // Payload too large (413)
  if (numStatus === 413 || msg.includes('payload too large') || msg.includes('request entity too large')) {
    return { category: 'payload', i18nKey: 'error.diagnosis.payload', navTarget: null }
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

  // Stream interrupted
  if (msg.includes('econnreset') || msg.includes('stream') || msg.includes('connection reset')) {
    return { category: 'stream', i18nKey: 'error.diagnosis.stream', navTarget: null }
  }

  // Content filter (400 + safety keywords)
  if (
    numStatus === 400 &&
    (msg.includes('content_filter') || msg.includes('safety') || msg.includes('content_policy'))
  ) {
    return { category: 'content', i18nKey: 'error.diagnosis.content', navTarget: null }
  }

  // Server errors (5xx)
  if (numStatus && numStatus >= 500) {
    return { category: 'server', i18nKey: 'error.diagnosis.server', navTarget: null }
  }

  // Model deprecated / retired
  if (msg.includes('deprecated') || msg.includes('retired') || msg.includes('sunset') || msg.includes('decommission')) {
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

  // OCR errors
  if (msg.includes('ocr') || msg.includes('engine not initialized') || msg.includes('recognition failed')) {
    return { category: 'ocr', i18nKey: 'error.diagnosis.ocr', navTarget: null }
  }

  // MCP errors
  if (msg.includes('mcp server') || msg.includes('mcp connection') || msg.includes('mcp error')) {
    return { category: 'mcp', i18nKey: 'error.diagnosis.mcp', navTarget: '/settings/mcp/servers' }
  }

  // Response parse errors
  if (
    msg.includes('json') ||
    msg.includes('unexpected token') ||
    msg.includes('invalid response') ||
    msg.includes('parse error')
  ) {
    return { category: 'parse', i18nKey: 'error.diagnosis.parse', navTarget: null }
  }

  return { category: 'unknown', i18nKey: 'error.diagnosis.unknown', navTarget: null }
}
