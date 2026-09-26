import { describe, expect, it } from 'vitest'

import { classifyErrorCategory, isProxyErrorMessage } from '../errorCategory'

describe('classifyErrorCategory HTTP 400', () => {
  it('identifies a provider request failure without guessing its cause', () => {
    expect(classifyErrorCategory({ status: 400, text: 'API Error: 400 Provider returned error' })).toBe('bad_request')
  })

  it.each([
    ['insufficient balance', 'quota'],
    ['content_filter triggered', 'content'],
    ['prompt is too long', 'context_length']
  ] as const)('preserves the specific diagnosis for %s', (text, category) => {
    expect(classifyErrorCategory({ status: 400, text })).toBe(category)
  })
})

// Transport failures from #19926 must reach a recovery category (network /
// stream / proxy) instead of falling through to 'unknown', which hides the
// settings recovery action and triggers a needless AI diagnosis call.
describe('classifyErrorCategory transport failures', () => {
  it('maps DNS resolution failure to network', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_NAME_NOT_RESOLVED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'net::ERR_NAME_RESOLUTION_FAILED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'request to https://api.example.com failed: getaddrinfo ENOTFOUND' })).toBe(
      'network'
    )
  })

  it('maps offline and unreachable signals to network', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_INTERNET_DISCONNECTED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'net::ERR_NETWORK_CHANGED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'net::ERR_ADDRESS_UNREACHABLE' })).toBe('network')
    expect(classifyErrorCategory({ text: 'connect ENETUNREACH 93.184.216.34:443' })).toBe('network')
    expect(classifyErrorCategory({ text: 'connect EHOSTUNREACH 93.184.216.34:443' })).toBe('network')
    expect(classifyErrorCategory({ text: 'getaddrinfo EAI_AGAIN api.example.com' })).toBe('network')
  })

  it('maps refused connections to network', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_REFUSED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'connect ECONNREFUSED 127.0.0.1:11434' })).toBe('network')
  })

  it('maps timeout failures to network', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_TIMED_OUT' })).toBe('network')
    expect(classifyErrorCategory({ text: 'net::ERR_TIMED_OUT' })).toBe('network')
    expect(classifyErrorCategory({ text: 'connect ETIMEDOUT 93.184.216.34:443' })).toBe('network')
  })

  it('maps aborted connections to network, not stream', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_ABORTED' })).toBe('network')
  })

  it('maps connection reset to stream', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_RESET' })).toBe('stream')
    expect(classifyErrorCategory({ text: 'read ECONNRESET' })).toBe('stream')
  })

  it('maps closed connections to stream', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_CLOSED' })).toBe('stream')
  })

  it('maps proxy tunnel failure to proxy', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_TUNNEL_CONNECTION_FAILED' })).toBe('proxy')
    expect(isProxyErrorMessage('net::ERR_TUNNEL_CONNECTION_FAILED')).toBe(true)
  })

  it('keeps proxy failures out of the network branch', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_PROXY_CONNECTION_FAILED' })).toBe('proxy')
  })

  // Provider requests go through Electron net.fetch, which wraps a rejected certificate in
  // `Cannot connect to API: net::ERR_CERT_*` — the cert code, not a `certificate` word, is
  // the only signal, and it must beat the generic network branch that matches the wrapper.
  it('maps Chromium certificate failures to proxy', () => {
    expect(classifyErrorCategory({ text: 'Cannot connect to API: net::ERR_CERT_AUTHORITY_INVALID' })).toBe('proxy')
    expect(classifyErrorCategory({ text: 'net::ERR_CERT_COMMON_NAME_INVALID' })).toBe('proxy')
    expect(classifyErrorCategory({ text: 'net::ERR_CERT_DATE_INVALID' })).toBe('proxy')
    expect(classifyErrorCategory({ text: 'net::ERR_CERT_REVOKED' })).toBe('proxy')
    expect(classifyErrorCategory({ text: 'net::ERR_SSL_PROTOCOL_ERROR' })).toBe('proxy')
  })

  it('maps Node OpenSSL certificate failures to proxy', () => {
    expect(classifyErrorCategory({ text: 'SELF_SIGNED_CERT_IN_CHAIN' })).toBe('proxy')
    expect(classifyErrorCategory({ text: 'unable to verify the first certificate' })).toBe('proxy')
    expect(classifyErrorCategory({ text: 'certificate has expired' })).toBe('proxy')
  })

  it('leaves unrelated failures unclassified', () => {
    expect(classifyErrorCategory({ text: 'Some totally unrelated failure' })).toBe('unknown')
  })
})

describe('classifyErrorCategory server failures', () => {
  it.each([500, 502, 503, 504, 522, 524, 529])('maps HTTP %i to server', (status) => {
    expect(classifyErrorCategory({ status })).toBe('server')
  })

  it.each([
    'Overloaded',
    'internal server error',
    'service unavailable',
    'Service temporarily unavailable',
    'Upstream service temporarily unavailable'
  ])('maps "%s" to server', (text) => {
    expect(classifyErrorCategory({ text })).toBe('server')
  })

  it('does not treat a bare temporarily unavailable phrase as an upstream server error', () => {
    expect(classifyErrorCategory({ text: 'temporarily unavailable' })).not.toBe('server')
  })

  it('keeps MCP service-unavailable errors in the MCP category', () => {
    expect(classifyErrorCategory({ text: 'MCP error: service unavailable' })).toBe('mcp')
  })

  it('keeps OCR service-unavailable errors in the OCR category', () => {
    expect(classifyErrorCategory({ text: 'OCR service unavailable' })).toBe('ocr')
  })

  it('does not treat Claude Code spawn failures as upstream server errors', () => {
    expect(classifyErrorCategory({ text: 'Failed to spawn Claude Code process: Service unavailable' })).not.toBe(
      'server'
    )
    expect(
      classifyErrorCategory({ text: 'Failed to spawn Claude Code process: Service temporarily unavailable' })
    ).not.toBe('server')
  })

  it.each(['Service unavailable', 'Overloaded', 'Internal server error'])(
    'does not treat a local Claude Code CLI "%s" message as an upstream server error',
    (text) => {
      expect(classifyErrorCategory({ text, source: 'claude-code' })).not.toBe('server')
    }
  )

  it('keeps an upstream-context Claude Code CLI error as a server failure', () => {
    expect(classifyErrorCategory({ text: 'Service temporarily unavailable', source: 'claude-code' })).not.toBe('server')
    expect(classifyErrorCategory({ text: 'API Error: Service temporarily unavailable', source: 'claude-code' })).toBe(
      'server'
    )
  })

  it('does not treat fuzzy upstream compatibility text as server', () => {
    expect(classifyErrorCategory({ text: 'upstream model compatibility check failed' })).not.toBe('server')
  })
})
