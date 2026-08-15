import { describe, expect, it } from 'vitest'

import { redactUrlToOrigin } from '../redactUrl'

describe('redactUrlToOrigin', () => {
  it('keeps only the origin for authenticated URLs with paths and query tokens', () => {
    expect(redactUrlToOrigin('http://user:pass@proxy.example:8080/path?token=secret#frag')).toBe(
      'http://proxy.example:8080'
    )
    expect(redactUrlToOrigin('https://api-key@server.example/mcp?access_token=secret')).toBe('https://server.example')
    expect(redactUrlToOrigin('socks5://user:pass@127.0.0.1:1080/path?token=secret')).toBe('socks5://127.0.0.1:1080')
  })

  it('redacts scheme-less proxy values to host and port only', () => {
    expect(redactUrlToOrigin('user:pass@proxy.example:8080/path?token=secret#frag')).toBe('proxy.example:8080')
    expect(redactUrlToOrigin('proxy.example:8080/path?token=secret')).toBe('proxy.example:8080')
  })

  it('falls back to a conservative marker for unparseable values', () => {
    expect(redactUrlToOrigin('not a url')).toBe('configured')
    expect(redactUrlToOrigin('http://')).toBe('configured')
    expect(redactUrlToOrigin('')).toBe('configured')
  })
})
