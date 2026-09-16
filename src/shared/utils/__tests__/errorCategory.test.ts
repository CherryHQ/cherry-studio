import { describe, expect, it } from 'vitest'

import { classifyErrorCategory, isProxyErrorMessage } from '../errorCategory'

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

  it('leaves unrelated failures unclassified', () => {
    expect(classifyErrorCategory({ text: 'Some totally unrelated failure' })).toBe('unknown')
  })
})
