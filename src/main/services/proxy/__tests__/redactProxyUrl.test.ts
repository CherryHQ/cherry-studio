import { describe, expect, it } from 'vitest'

import { redactProxyUrlToOrigin } from '../redactProxyUrl'

describe('redactProxyUrlToOrigin', () => {
  it('keeps only the origin for valid proxy URLs', () => {
    expect(redactProxyUrlToOrigin('http://user:pass@proxy.example:8080/path?token=secret#frag')).toBe(
      'http://proxy.example:8080'
    )
    expect(redactProxyUrlToOrigin('https://proxy.example/path?token=secret#frag')).toBe('https://proxy.example')
    expect(redactProxyUrlToOrigin('socks5://user:pass@127.0.0.1:1080/path?token=secret')).toBe(
      'socks5://127.0.0.1:1080'
    )
  })

  it('redacts scheme-less proxy values to host and port only', () => {
    expect(redactProxyUrlToOrigin('user:pass@proxy.example:8080/path?token=secret#frag')).toBe('proxy.example:8080')
    expect(redactProxyUrlToOrigin('proxy.example:8080/path?token=secret')).toBe('proxy.example:8080')
  })

  it('falls back to a conservative marker for unparseable values', () => {
    expect(redactProxyUrlToOrigin('not a url')).toBe('configured')
    expect(redactProxyUrlToOrigin('http://')).toBe('configured')
    expect(redactProxyUrlToOrigin('')).toBe('configured')
  })
})
