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

  it('keeps pending attribution per session when numeric request ids collide', () => {
    let now = 0
    const methods = new RequestMethods(4, 1000, () => now)
    // Both webview partitions start counting at 1; the same id must not let one
    // session's completion release the other session's POST.
    methods.record('https://example.com/export', 'POST', 1, 'agent-browser')
    methods.record('https://example.com/file', 'GET', 1, 'agent-dev-preview')
    methods.finish(1, 'agent-dev-preview')

    now = 60_000
    // The history entry expired; only the pending POST can keep it non-replayable.
    expect(methods.methodFor('https://example.com/export', 'agent-browser')).toBeUndefined()
  })

  it('drops only the disposed session\u2019s outstanding requests', () => {
    const methods = new RequestMethods(4, 600_000, () => 0)
    methods.record('https://example.com/a', 'POST', 7, 'agent-browser')
    methods.record('https://example.com/b', 'POST', 7, 'agent-html-artifact')

    methods.forgetScope('agent-browser')

    // Its pending entry is gone, so the long-lived history entry answers instead.
    expect(methods.methodFor('https://example.com/a', 'agent-browser')).toBe('POST')
    // The other session's pending entry is untouched.
    expect(methods.methodFor('https://example.com/b', 'agent-html-artifact')).toBeUndefined()
  })

  it('does not let an outstanding GET block a takeover', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/file', 'GET', 1)

    expect(methods.methodFor('https://example.com/file')).toBe('GET')
  })

  it('keeps the referrer of the last request so the replay can resend it', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/report.pdf', 'GET', 1, 'agent-browser', 'https://example.com/inbox')

    expect(methods.referrerFor('https://example.com/report.pdf')).toBe('https://example.com/inbox')
  })

  it('replaces the referrer with the one attached to the download request', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/report.pdf', 'GET', 1, 'agent-browser', 'https://example.com/inbox')
    methods.record('https://example.com/report.pdf', 'GET', 2, 'agent-browser', 'https://example.com/viewer')

    expect(methods.referrerFor('https://example.com/report.pdf')).toBe('https://example.com/viewer')
  })

  it('reports no referrer for a request that carried none', () => {
    const methods = new RequestMethods(4, 60_000, () => 0)
    methods.record('https://example.com/report.pdf', 'GET', 1, 'agent-browser')

    expect(methods.referrerFor('https://example.com/report.pdf')).toBeUndefined()
  })

  it('only treats requests without a body as replayable', () => {
    expect(isReplayableDownload('GET')).toBe(true)
    expect(isReplayableDownload('HEAD')).toBe(true)
    expect(isReplayableDownload('POST')).toBe(false)
    expect(isReplayableDownload(undefined)).toBe(false)
  })
})
