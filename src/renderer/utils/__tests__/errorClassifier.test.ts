import type { SerializedError } from '@renderer/types/error'
import { describe, expect, it } from 'vitest'

import { classifyError } from '../errorClassifier'

function makeError(overrides: Partial<SerializedError> = {}): SerializedError {
  return { name: 'Error', message: 'test error', stack: null, ...overrides }
}

describe('classifyError', () => {
  it('returns unknown for undefined error', () => {
    const result = classifyError(undefined)
    expect(result.category).toBe('unknown')
    expect(result.navTarget).toBeNull()
  })

  it('returns unknown for empty error', () => {
    const result = classifyError(makeError({ message: '' }))
    expect(result.category).toBe('unknown')
  })

  // Auth
  it('classifies 401 as auth', () => {
    const result = classifyError(makeError({ statusCode: 401 }))
    expect(result.category).toBe('auth')
    expect(result.navTarget).toBe('/settings/provider')
  })

  it('classifies 401 as auth with providerId in navTarget', () => {
    const result = classifyError(makeError({ statusCode: 401 }), 'openai')
    expect(result.category).toBe('auth')
    expect(result.navTarget).toBe('/settings/provider?id=openai')
  })

  it('classifies 403 as auth', () => {
    const result = classifyError(makeError({ statusCode: 403 }))
    expect(result.category).toBe('auth')
  })

  it('classifies a 403 unsupported-country response as region', () => {
    const result = classifyError(
      makeError({
        statusCode: 403,
        message: 'Country, region, or territory not supported (unsupported_country_region_territory)'
      })
    )
    expect(result.category).toBe('region')
    expect(result.navTarget).toBe('/settings/system')
  })

  it('classifies a service unavailable in the user region as region', () => {
    const result = classifyError(makeError({ message: 'This service is not available in your region' }))
    expect(result.category).toBe('region')
  })

  it('does not classify an unavailable account plan as region', () => {
    const result = classifyError(
      makeError({ message: 'This model is not available in your account, please upgrade your plan' })
    )
    expect(result.category).not.toBe('region')
  })

  it('classifies invalid_api_key message as auth', () => {
    const result = classifyError(makeError({ message: 'invalid_api_key: key is expired' }))
    expect(result.category).toBe('auth')
  })

  it('classifies forbidden message as auth', () => {
    const result = classifyError(makeError({ message: 'Forbidden: access denied' }))
    expect(result.category).toBe('auth')
  })

  // Model
  it('classifies 404 as model', () => {
    const result = classifyError(makeError({ statusCode: 404 }))
    expect(result.category).toBe('model')
  })

  it('classifies model_not_found message as model', () => {
    const result = classifyError(makeError({ message: 'model_not_found: gpt-5' }))
    expect(result.category).toBe('model')
  })

  it('classifies a missing configured model id as model', () => {
    const result = classifyError(makeError({ message: "Model with id 'provider/model' not found" }))

    expect(result.category).toBe('model')
    expect(result.i18nKey).toBe('error.diagnosis.model')
  })

  // Rate limit
  it('classifies 429 as rate_limit', () => {
    const result = classifyError(makeError({ statusCode: 429 }))
    expect(result.category).toBe('rate_limit')
  })

  it('classifies rate_limit message as rate_limit', () => {
    const result = classifyError(makeError({ message: 'rate limit exceeded' }))
    expect(result.category).toBe('rate_limit')
  })

  it('classifies too many requests as rate_limit', () => {
    const result = classifyError(makeError({ message: 'Too many requests' }))
    expect(result.category).toBe('rate_limit')
  })

  // Quota
  it('classifies insufficient_quota message as quota', () => {
    const result = classifyError(makeError({ message: 'insufficient_quota' }))
    expect(result.category).toBe('quota')
  })

  it('classifies insufficient_balance message as quota', () => {
    const result = classifyError(makeError({ message: 'insufficient_balance' }))
    expect(result.category).toBe('quota')
  })

  it('does not classify insufficient permissions as quota', () => {
    const result = classifyError(makeError({ message: 'insufficient permissions' }))
    expect(result.category).not.toBe('quota')
  })

  it('prefers quota over rate_limit when both signals appear', () => {
    const result = classifyError(makeError({ statusCode: 429, message: 'rate limit: insufficient_balance' }))
    expect(result.category).toBe('quota')
  })

  it('reads quota signals from responseBody before classifying a 429', () => {
    const result = classifyError(
      makeError({
        statusCode: 429,
        message: 'Rate limit exceeded',
        responseBody: '{"error":{"type":"insufficient_quota","code":"billing_hard_limit_reached"}}'
      })
    )
    expect(result.category).toBe('quota')
  })

  it('reads quota signals from structured data', () => {
    const result = classifyError(
      makeError({
        statusCode: 429,
        message: 'Rate limit exceeded',
        data: { error: { code: 'billing_hard_limit_reached' } }
      })
    )
    expect(result.category).toBe('quota')
  })

  it('classifies HTTP 402 as quota', () => {
    const result = classifyError(makeError({ statusCode: 402, message: 'Payment Required' }))
    expect(result.category).toBe('quota')
    expect(result.navTarget).toBe('/settings/provider')
  })

  // Network
  it('classifies econnrefused as network', () => {
    const result = classifyError(makeError({ message: 'connect ECONNREFUSED 127.0.0.1:443' }))
    expect(result.category).toBe('network')
    expect(result.navTarget).toBe('/settings/system')
  })

  it('classifies timeout as network', () => {
    const result = classifyError(makeError({ message: 'Request timeout after 30000ms' }))
    expect(result.category).toBe('network')
  })

  it('classifies fetch failed as network', () => {
    const result = classifyError(makeError({ message: 'fetch failed' }))
    expect(result.category).toBe('network')
  })

  it('classifies MCP timeout as mcp instead of network', () => {
    const result = classifyError(makeError({ message: 'MCP server timeout after 30000ms' }))
    expect(result.category).toBe('mcp')
  })

  it('classifies OCR timeout as ocr instead of network', () => {
    const result = classifyError(makeError({ message: 'OCR engine timeout' }))
    expect(result.category).toBe('ocr')
  })

  // Narrow and provider-specific variants
  it('classifies an Anthropic long prompt as context_length', () => {
    const result = classifyError(makeError({ message: 'prompt is too long: 200000 tokens > 199999' }))
    expect(result.category).toBe('context_length')
  })

  it('classifies a context window error as context_length', () => {
    const result = classifyError(makeError({ message: 'request exceeds the context window of this model' }))
    expect(result.category).toBe('context_length')
  })

  it('classifies ECONNRESET as stream', () => {
    const result = classifyError(makeError({ message: 'socket hang up: ECONNRESET' }))
    expect(result.category).toBe('stream')
  })

  it('does not classify a bare stream mention as stream', () => {
    const result = classifyError(makeError({ message: 'stream not supported by this model' }))
    expect(result.category).not.toBe('stream')
  })

  it('classifies an unexpected token response as parse', () => {
    const result = classifyError(makeError({ message: "Unexpected token '<' in JSON at position 0" }))
    expect(result.category).toBe('parse')
  })

  it('does not classify a bare JSON mention as parse', () => {
    const result = classifyError(makeError({ message: 'max_tokens must be a valid JSON number' }))
    expect(result.category).not.toBe('parse')
  })

  it('classifies a deprecated model as deprecated', () => {
    const result = classifyError(makeError({ message: 'This model has been deprecated, please upgrade' }))
    expect(result.category).toBe('deprecated')
  })

  it('does not classify a deprecated parameter as a deprecated model', () => {
    const result = classifyError(
      makeError({ message: 'Warning: parameter max_tokens is deprecated, use max_completion_tokens' })
    )
    expect(result.category).not.toBe('deprecated')
  })

  it('classifies an overloaded provider as server', () => {
    const result = classifyError(makeError({ statusCode: 529, message: 'Overloaded' }))
    expect(result.category).toBe('server')
  })

  // Content filter
  it('classifies 400 + content_filter as content', () => {
    const result = classifyError(makeError({ statusCode: 400, message: 'content_filter triggered' }))
    expect(result.category).toBe('content')
    expect(result.navTarget).toBeNull()
  })

  it('classifies content_filter without a status', () => {
    const result = classifyError(makeError({ message: 'content_filter triggered' }))
    expect(result.category).toBe('content')
  })

  it('classifies a structured SAFETY finish reason as content', () => {
    const result = classifyError(makeError({ message: 'no object generated', finishReason: 'SAFETY' }))
    expect(result.category).toBe('content')
  })

  it('classifies a structured RECITATION finish reason as content', () => {
    const result = classifyError(makeError({ message: 'no object generated', finishReason: 'RECITATION' }))
    expect(result.category).toBe('content')
  })

  // Server
  it('classifies 500 as server', () => {
    const result = classifyError(makeError({ statusCode: 500 }))
    expect(result.category).toBe('server')
  })

  it('classifies 503 as server', () => {
    const result = classifyError(makeError({ statusCode: 503 }))
    expect(result.category).toBe('server')
  })

  // Knowledge
  it('classifies embedding error as knowledge', () => {
    const result = classifyError(makeError({ message: 'embedding model failed' }))
    expect(result.category).toBe('knowledge')
    expect(result.navTarget).toBe('/knowledge')
  })

  it('classifies knowledge base error as knowledge', () => {
    const result = classifyError(makeError({ message: 'knowledge base not found' }))
    expect(result.category).toBe('knowledge')
  })

  it('does not match plain "knowledge" without "base"', () => {
    const result = classifyError(makeError({ message: 'some knowledge issue' }))
    expect(result.category).not.toBe('knowledge')
  })

  // OCR
  it('classifies ocr error', () => {
    const result = classifyError(makeError({ message: 'OCR engine not initialized' }))
    expect(result.category).toBe('ocr')
    expect(result.navTarget).toBeNull()
  })

  // MCP
  it('classifies mcp server error', () => {
    const result = classifyError(makeError({ message: 'MCP server failed to start' }))
    expect(result.category).toBe('mcp')
    expect(result.navTarget).toBe('/settings/mcp/servers')
  })

  it('classifies mcp connection error', () => {
    const result = classifyError(makeError({ message: 'MCP connection refused' }))
    expect(result.category).toBe('mcp')
  })

  it('does not match plain "mcp" without qualifier', () => {
    const result = classifyError(makeError({ message: 'something mcp related' }))
    expect(result.category).not.toBe('mcp')
  })

  // Status as string
  it('handles status as string', () => {
    const result = classifyError(makeError({ status: '401' }))
    expect(result.category).toBe('auth')
  })

  it('prioritizes finishReason over status code', () => {
    const result = classifyError(makeError({ finishReason: 'content-filter', statusCode: 500 }))
    expect(result.category).toBe('content')
  })
})
