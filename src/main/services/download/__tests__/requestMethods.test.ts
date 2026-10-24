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

  it('keeps a pending POST ambiguous when a later GET arrives', () => {
    let now = 0
    const methods = new RequestMethods(4, 600_000, () => now)
    methods.record('https://example.com/export', 'POST')

    now = 120_000
    methods.record('https://example.com/export', 'GET')

    expect(methods.methodFor('https://example.com/export')).toBeUndefined()
  })

  it('keeps a GET replayable after the manager probes the same url with HEAD', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/file', 'GET')
    methods.record('https://example.com/file', 'HEAD')

    expect(methods.methodFor('https://example.com/file')).toBe('GET')
  })

  it('reports a url only ever seen with HEAD as replayable', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/probe', 'HEAD')

    expect(methods.methodFor('https://example.com/probe')).toBe('HEAD')
  })

  it('keeps an outstanding POST non-replayable after its history entry expires', () => {
    let now = 0
    const methods = new RequestMethods(4, 1000, () => now)
    methods.record('https://example.com/export', 'POST', 1)

    now = 60_000
    // The pending POST outlived its history entry; a later GET must not turn the
    // still-unanswered attachment into a replayable one.
    methods.record('https://example.com/export', 'GET')

    expect(methods.methodFor('https://example.com/export')).toBeUndefined()
  })

  it('keeps an outstanding POST non-replayable when the history cache evicts it', () => {
    const methods = new RequestMethods(2, 60_000, () => 0)
    methods.record('https://example.com/export', 'POST', 1)
    for (let index = 0; index < 5; index++) methods.record(`https://example.com/${index}`, 'GET')

    methods.record('https://example.com/export', 'GET')

    expect(methods.methodFor('https://example.com/export')).toBeUndefined()
  })

  it('forgets an outstanding request once it completes', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/export', 'POST', 1)
    methods.finish(1)

    expect(methods.methodFor('https://example.com/export')).toBe('POST')
  })

  it('does not let an outstanding GET block a takeover', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/file', 'GET', 1)

    expect(methods.methodFor('https://example.com/file')).toBe('GET')
  })

  it('only treats requests without a body as replayable', () => {
    expect(isReplayableDownload('GET')).toBe(true)
    expect(isReplayableDownload('HEAD')).toBe(true)
    expect(isReplayableDownload('POST')).toBe(false)
    expect(isReplayableDownload(undefined)).toBe(false)
  })
})
