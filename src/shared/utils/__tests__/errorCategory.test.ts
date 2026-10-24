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
  describe('relay EOF wording', () => {
    const reportedMessage =
      'upstream stream ended without a terminal frame (no message_delta, no message_stop); the response is truncated and incomplete; received 114 frames; reason=eof'

    it('classifies the reported truncated response without an HTTP status as stream', () => {
      expect(classifyErrorCategory({ text: reportedMessage })).toBe('stream')
    })

    it.each([
      'stream ended without a terminal frame',
      `Provider: ${reportedMessage.toUpperCase()}`,
      'upstream stream ended without a terminal frame (no message_delta, no message_stop); the response is truncated and incomplete; received 27 frames'
    ])('recognizes relay wording independently of casing, frame count, and EOF suffix: %s', (text) => {
      expect(classifyErrorCategory({ text })).toBe('stream')
    })

    it.each([
      [500, 'server'],
      [503, 'server'],
      [429, 'rate_limit'],
      [401, 'auth'],
      [402, 'quota'],
      [404, 'model'],
      [413, 'payload'],
      [403, 'permission'],
      [400, 'stream']
    ] as const)('preserves HTTP %i precedence for relay wording as %s', (status, category) => {
      expect(classifyErrorCategory({ text: reportedMessage, status })).toBe(category)
    })

    it('preserves structured safety classification ahead of relay wording', () => {
      expect(classifyErrorCategory({ text: reportedMessage, finishReason: 'SAFETY' })).toBe('content')
    })

    it('prioritizes the specific relay failure over a generic fetch failure', () => {
      expect(classifyErrorCategory({ text: 'fetch failed; stream ended without a terminal frame' })).toBe('stream')
    })

    it.each([
      'econnreset',
      'connection reset',
      'err_connection_reset',
      'err_connection_closed',
      'stream interrupted',
      'stream closed',
      'stream aborted',
      'stream ended unexpectedly',
      'premature close'
    ])('preserves existing stream transport wording: %s', (text) => {
      expect(classifyErrorCategory({ text })).toBe('stream')
    })

    it.each([
      'Response stream ended without a finish reason.',
      'RESPONSE STREAM ENDED WITHOUT A FINISH REASON.',
      'Provider: Response stream ended without a finish reason.'
    ])('keeps incomplete finish-reason responses in parse: %s', (text) => {
      expect(classifyErrorCategory({ text })).toBe('parse')
    })

    it.each([
      ['Service unavailable', 'server'],
      ['Overloaded', 'server'],
      ['net::ERR_CONNECTION_ABORTED', 'network'],
      ['SELF_SIGNED_CERT_IN_CHAIN', 'proxy'],
      ['model_not_found', 'model'],
      ['prompt is too long', 'context_length']
    ] as const)('preserves the neighbouring diagnosis for %s', (text, category) => {
      expect(classifyErrorCategory({ text })).toBe(category)
    })

    it('preserves rate limiting for HTTP 429', () => {
      expect(classifyErrorCategory({ text: 'too many requests', status: 429 })).toBe('rate_limit')
    })

    it.each([
      'eof',
      'reason=eof',
      'unexpected EOF',
      'stream ended',
      'stream ended without',
      'stream ended without terminal frame',
      'missing terminal frame',
      'no message_delta',
      'no message_stop',
      'response is truncated and incomplete',
      'Streaming is not supported for this model',
      'Claude Code process exited with code 1'
    ])('does not infer a stream failure from ambiguous wording: %s', (text) => {
      expect(classifyErrorCategory({ text })).toBe('unknown')
      expect(classifyErrorCategory({ text, status: 400 })).toBe('bad_request')
    })
  })

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

  it.each(['unauthorized', 'insufficient_balance', 'too many requests', 'model_not_found'])(
    'maps HTTP 503 with a "%s" message to server',
    (text) => {
      expect(classifyErrorCategory({ status: 503, text })).toBe('server')
    }
  )
})

// Client-refusal gateways reject third-party clients with auth-flavored wording that names the
// CLIENT, not the key ("unauthorized client detected, contact support" — #21376). Filing that
// under auth claims the key is invalid and sends users off regenerating working keys; it is a
// refusal (permission), and explicit key-invalidity signals must still win.
describe('classifyErrorCategory client refusals', () => {
  it('maps "unauthorized client" refusals to permission, not auth', () => {
    expect(
      classifyErrorCategory({
        status: 401,
        text: 'unauthorized client detected, contact support for assistance at https://discord.gg/HgekCyHJqB'
      })
    ).toBe('permission')
  })

  it('keeps explicit key-invalidity signals in auth even alongside client wording', () => {
    expect(classifyErrorCategory({ text: 'unauthorized client: invalid api key' })).toBe('auth')
    expect(classifyErrorCategory({ status: 401, text: 'invalid_api_key for unauthorized client' })).toBe('auth')
  })

  it('maps policy refusals that merely mention the key to permission', () => {
    // The refusal names the client as the policy subject; the key is mentioned but not
    // declared invalid ("this api key does not permit third-party clients" — #21376).
    expect(
      classifyErrorCategory({
        status: 401,
        text: 'unauthorized client detected; this api key does not permit third-party clients'
      })
    ).toBe('permission')
  })

  it('keeps plain unauthorized responses in auth', () => {
    expect(classifyErrorCategory({ status: 401, text: 'Unauthorized' })).toBe('auth')
    expect(classifyErrorCategory({ text: 'authentication required' })).toBe('auth')
  })
})

// Protocol failures need the existing parse diagnosis without swallowing request or transport failures.
describe('classifyErrorCategory provider response protocol', () => {
  const phrases = [
    'Invalid input: expected object, received undefined',
    'Type validation failed:',
    "Expected 'function.name' to be a string.",
    "Expected 'id' to be a string.",
    'Response stream ended without a finish reason.'
  ]

  it.each(phrases)('classifies %s as parse case-insensitively', (text) => {
    expect(classifyErrorCategory({ text })).toBe('parse')
    expect(classifyErrorCategory({ text: `Provider: ${text.toUpperCase()} Details` })).toBe('parse')
  })

  it.each([
    'Invalid input: temperature must be positive',
    'Validation failed for request parameter',
    'Expected a function result',
    'Streaming is not supported for this model'
  ])('does not broaden matching to unrelated text: %s', (text) => {
    expect(classifyErrorCategory({ text })).toBe('unknown')
  })

  it.each([
    [401, 'auth'],
    [429, 'rate_limit'],
    [500, 'server']
  ] as const)('preserves HTTP %i precedence over protocol phrases', (status, category) => {
    for (const text of phrases) expect(classifyErrorCategory({ status, text })).toBe(category)
  })

  it('preserves transport and request classifications', () => {
    expect(classifyErrorCategory({ text: 'ECONNRESET' })).toBe('stream')
    expect(classifyErrorCategory({ text: 'ETIMEDOUT' })).toBe('network')
    expect(classifyErrorCategory({ status: 400, text: 'Invalid input: temperature must be positive' })).toBe(
      'bad_request'
    )
  })
})
