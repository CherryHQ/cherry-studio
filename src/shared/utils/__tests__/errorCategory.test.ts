import { describe, expect, it } from 'vitest'

import { classifyErrorCategory, isProxyErrorMessage } from '../errorCategory'

describe('classifyErrorCategory transport failures', () => {
  it('maps DNS resolution failure to network', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_NAME_NOT_RESOLVED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'request failed: getaddrinfo ENOTFOUND' })).toBe('network')
  })

  it('maps connection reset to stream', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_RESET' })).toBe('stream')
    expect(classifyErrorCategory({ text: 'read ECONNRESET' })).toBe('stream')
  })

  it('maps proxy tunnel failure to proxy', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_TUNNEL_CONNECTION_FAILED' })).toBe('proxy')
    expect(isProxyErrorMessage('net::ERR_TUNNEL_CONNECTION_FAILED')).toBe(true)
  })

  it('keeps refused connections and offline signals on network', () => {
    expect(classifyErrorCategory({ text: 'net::ERR_CONNECTION_REFUSED' })).toBe('network')
    expect(classifyErrorCategory({ text: 'net::ERR_INTERNET_DISCONNECTED' })).toBe('network')
  })

  it('leaves unrelated failures unclassified', () => {
    expect(classifyErrorCategory({ text: 'Some totally unrelated failure' })).toBe('unknown')
  })
})
