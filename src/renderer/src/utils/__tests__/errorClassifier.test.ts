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

  // Quota
  it('classifies 429 as quota', () => {
    const result = classifyError(makeError({ statusCode: 429 }))
    expect(result.category).toBe('quota')
  })

  it('classifies rate_limit message as quota', () => {
    const result = classifyError(makeError({ message: 'rate limit exceeded' }))
    expect(result.category).toBe('quota')
  })

  it('classifies insufficient_quota message as quota', () => {
    const result = classifyError(makeError({ message: 'insufficient_quota' }))
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

  // Content filter
  it('classifies 400 + content_filter as content', () => {
    const result = classifyError(makeError({ statusCode: 400, message: 'content_filter triggered' }))
    expect(result.category).toBe('content')
    expect(result.navTarget).toBeNull()
  })

  it('does not classify content_filter without 400 status', () => {
    const result = classifyError(makeError({ message: 'content_filter triggered' }))
    expect(result.category).not.toBe('content')
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
