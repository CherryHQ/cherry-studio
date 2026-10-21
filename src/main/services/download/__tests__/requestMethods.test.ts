import { describe, expect, it } from 'vitest'

import { isReplayableDownload, RequestMethods } from '../requestMethods'

describe('RequestMethods', () => {
  it('returns the recorded method and forgets it after the ttl', () => {
    let now = 0
    const methods = new RequestMethods(4, 1000, () => now)
    methods.record('https://example.com/file', 'post')

    expect(methods.methodFor('https://example.com/file')).toBe('POST')

    now = 1001
    expect(methods.methodFor('https://example.com/file')).toBeUndefined()
  })

  it('stays bounded when a page outruns the ttl with new requests', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    for (let index = 0; index < 10; index++) methods.record(`https://example.com/${index}`, 'GET')

    expect(methods.methodFor('https://example.com/9')).toBe('GET')
    expect(methods.methodFor('https://example.com/0')).toBeUndefined()
  })

  it('treats a URL seen with different methods as un-attributable', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/export', 'POST')
    methods.record('https://example.com/export', 'GET')

    expect(methods.methodFor('https://example.com/export')).toBeUndefined()
  })

  it('only treats requests without a body as replayable', () => {
    expect(isReplayableDownload('GET')).toBe(true)
    expect(isReplayableDownload('HEAD')).toBe(true)
    expect(isReplayableDownload('POST')).toBe(false)
    expect(isReplayableDownload(undefined)).toBe(false)
  })
})
