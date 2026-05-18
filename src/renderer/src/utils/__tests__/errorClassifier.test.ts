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

  // Region / geo-block
  it('classifies 403 with unsupported_country as region (not auth)', () => {
    const result = classifyError(
      makeError({
        statusCode: 403,
        message: 'Country, region, or territory not supported (unsupported_country_region_territory)'
      })
    )
    expect(result.category).toBe('region')
    expect(result.navTarget).toBe('/settings/general')
  })

  it('classifies "not available in your region" as region', () => {
    const result = classifyError(makeError({ message: 'This service is not available in your region' }))
    expect(result.category).toBe('region')
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

  it('prefers quota over rate_limit when both keywords appear', () => {
    const result = classifyError(makeError({ statusCode: 429, message: 'rate limit: insufficient_balance' }))
    expect(result.category).toBe('quota')
  })

  // Network
  it('classifies econnrefused as network', () => {
    const result = classifyError(makeError({ message: 'connect ECONNREFUSED 127.0.0.1:443' }))
    expect(result.category).toBe('network')
    expect(result.navTarget).toBe('/settings/general')
  })

  it('classifies timeout as network', () => {
    const result = classifyError(makeError({ message: 'Request timeout after 30000ms' }))
    expect(result.category).toBe('network')
  })

  it('classifies fetch failed as network', () => {
    const result = classifyError(makeError({ message: 'fetch failed' }))
    expect(result.category).toBe('network')
  })

  // Specialized timeouts route to their own categories, not network
  it('classifies MCP timeout as mcp (not network)', () => {
    const result = classifyError(makeError({ message: 'MCP server timeout after 30000ms' }))
    expect(result.category).toBe('mcp')
  })

  it('classifies OCR timeout as ocr (not network)', () => {
    const result = classifyError(makeError({ message: 'OCR engine timeout' }))
    expect(result.category).toBe('ocr')
  })

  // Context length variants
  it('classifies Anthropic "prompt is too long" as context_length', () => {
    const result = classifyError(makeError({ message: 'prompt is too long: 200000 tokens > 199999' }))
    expect(result.category).toBe('context_length')
  })

  it('classifies context window message as context_length', () => {
    const result = classifyError(makeError({ message: 'request exceeds the context window of this model' }))
    expect(result.category).toBe('context_length')
  })

  // Stream — narrow keywords
  it('classifies econnreset as stream', () => {
    const result = classifyError(makeError({ message: 'socket hang up: ECONNRESET' }))
    expect(result.category).toBe('stream')
  })

  it('does not match bare "stream" as stream', () => {
    const result = classifyError(makeError({ message: 'stream not supported by this model' }))
    expect(result.category).not.toBe('stream')
  })

  // Parse — narrow keywords
  it('classifies unexpected token as parse', () => {
    const result = classifyError(makeError({ message: "Unexpected token '<' in JSON at position 0" }))
    expect(result.category).toBe('parse')
  })

  it('does not match bare "json" as parse', () => {
    const result = classifyError(makeError({ message: 'max_tokens must be a valid JSON number' }))
    expect(result.category).not.toBe('parse')
  })

  // Deprecated — require co-occurrence with "model"
  it('classifies "model has been deprecated" as deprecated', () => {
    const result = classifyError(makeError({ message: 'This model has been deprecated, please upgrade' }))
    expect(result.category).toBe('deprecated')
  })

  it('does not match "parameter is deprecated" as deprecated', () => {
    const result = classifyError(
      makeError({ message: 'Warning: parameter max_tokens is deprecated, use max_completion_tokens' })
    )
    expect(result.category).not.toBe('deprecated')
  })

  // Server — overloaded
  it('classifies "overloaded" message as server', () => {
    const result = classifyError(makeError({ statusCode: 529, message: 'Overloaded' }))
    expect(result.category).toBe('server')
  })

  // Content filter
  it('classifies content_filter as content (regardless of status)', () => {
    const result = classifyError(makeError({ statusCode: 400, message: 'content_filter triggered' }))
    expect(result.category).toBe('content')
    expect(result.navTarget).toBeNull()
  })

  it('classifies content_filter without status as content', () => {
    const result = classifyError(makeError({ message: 'content_filter triggered' }))
    expect(result.category).toBe('content')
  })

  it('classifies Gemini SAFETY finishReason as content', () => {
    const result = classifyError(makeError({ message: 'Response blocked: finishReason: SAFETY' }))
    expect(result.category).toBe('content')
  })

  it('classifies prohibited_content as content', () => {
    const result = classifyError(makeError({ message: 'prohibited_content detected by safety system' }))
    expect(result.category).toBe('content')
  })

  it('classifies finishReason=SAFETY as content (structured signal)', () => {
    const result = classifyError(makeError({ message: 'no object generated', finishReason: 'SAFETY' as any }))
    expect(result.category).toBe('content')
  })

  it('classifies finishReason=RECITATION as content', () => {
    const result = classifyError(makeError({ message: 'no object generated', finishReason: 'RECITATION' as any }))
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
})
