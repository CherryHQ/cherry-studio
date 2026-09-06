import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const abortRequest = vi.fn().mockResolvedValue(undefined)
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => abortRequest(...args) } }))

import {
  collectLiveSessionIds,
  tabSessionIdFromUrl,
  tabSessionRegistry,
  withoutTabSession
} from '../TabSessionRegistry'

const routeTab = (url: string, id = url): Tab => ({ id, type: 'route', url, title: '' })

describe('collectLiveSessionIds', () => {
  it('collects the sessionId of every open route tab', () => {
    const ids = collectLiveSessionIds([
      routeTab('/app/translate?tabSession=a'),
      routeTab('/app/translate?tabSession=b')
    ])

    expect(ids).toEqual(new Set(['a', 'b']))
  })

  it('drops a session whose tab navigated away to the bare route', () => {
    // The sidebar rewrites the tab url in place, which is what ends a session.
    expect(collectLiveSessionIds([routeTab('/app/chat')])).toEqual(new Set())
  })

  it('ignores webview tabs and malformed urls', () => {
    const webview: Tab = { id: 'w', type: 'webview', url: 'https://x.test?tabSession=a', title: '' }

    expect(collectLiveSessionIds([webview, routeTab('::::', 'bad')])).toEqual(new Set())
  })
})

describe('withoutTabSession', () => {
  it('strips only the session id, keeping the route and other params', () => {
    expect(withoutTabSession('/app/translate?tabSession=a')).toBe('/app/translate')
    expect(withoutTabSession('/app/translate?tabSession=a&view=split')).toBe('/app/translate?view=split')
  })

  it('leaves a url without a session id untouched', () => {
    // Agent conversations carry their own `sessionId`, which points at a database row and must
    // survive a restart — only `tabSession` is renderer memory.
    expect(withoutTabSession('/app/agents?sessionId=agent-1')).toBe('/app/agents?sessionId=agent-1')
    expect(tabSessionIdFromUrl('/app/agents?sessionId=agent-1')).toBeUndefined()
  })
})

describe('tabSessionRegistry', () => {
  beforeEach(() => {
    abortRequest.mockClear()
  })

  it('aborts the run of a session whose tab is gone, and leaves an open tab alone', () => {
    tabSessionRegistry.getOrCreate('gone', () => true).addStream('translate:gone')
    tabSessionRegistry.getOrCreate('open', () => true).addStream('translate:open')

    tabSessionRegistry.sweep(new Set(['open']))

    expect(abortRequest).toHaveBeenCalledExactlyOnceWith('ai.stream.abort', { topicId: 'translate:gone' })
  })

  it('does not release a session in the same pass that finds it unreachable', () => {
    // A tab's url stops naming its session before the page rendering it unmounts, so releasing
    // here would drop cache keys a mounted `useCache` still holds (#20074).
    const release = vi.fn(() => true)
    tabSessionRegistry.getOrCreate('deferred', release)

    tabSessionRegistry.sweep(new Set())
    expect(release).not.toHaveBeenCalled()
    expect(tabSessionRegistry.get('deferred')).toBeDefined()

    tabSessionRegistry.releaseUnreachable()
    expect(release).toHaveBeenCalledOnce()
    expect(tabSessionRegistry.get('deferred')).toBeUndefined()
  })

  it('never releases a session whose tab is still open', () => {
    const release = vi.fn(() => true)
    tabSessionRegistry.getOrCreate('kept', release)

    tabSessionRegistry.sweep(new Set(['kept']))
    tabSessionRegistry.releaseUnreachable()

    expect(release).not.toHaveBeenCalled()
    expect(tabSessionRegistry.get('kept')).toBeDefined()
  })

  it('keeps a session whose release was refused, and tries again on the next pass', () => {
    // The cache refuses to drop a key its hook still reads — dropping the session here would
    // leak the entry for good.
    let releasable = false
    const release = vi.fn(() => releasable)
    tabSessionRegistry.getOrCreate('retry-me', release)

    tabSessionRegistry.sweep(new Set())
    tabSessionRegistry.releaseUnreachable()
    expect(tabSessionRegistry.get('retry-me')).toBeDefined()

    releasable = true
    tabSessionRegistry.releaseUnreachable()
    expect(tabSessionRegistry.get('retry-me')).toBeUndefined()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('drops a session whose release threw, rather than retrying it forever', () => {
    const release = vi.fn(() => {
      throw new Error('boom')
    })
    tabSessionRegistry.getOrCreate('throwing', release)

    tabSessionRegistry.sweep(new Set())
    tabSessionRegistry.releaseUnreachable()
    tabSessionRegistry.releaseUnreachable()

    expect(release).toHaveBeenCalledOnce()
    expect(tabSessionRegistry.get('throwing')).toBeUndefined()
  })

  it('reports busy only while a stream is unfinished', () => {
    const handle = tabSessionRegistry.getOrCreate('busy-check', () => true)
    expect(handle.isBusy()).toBe(false)

    const finish = handle.addStream('translate:busy-check')
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(true)

    finish()
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(false)
  })

  it('does not abort a finished stream when the session is later released', () => {
    tabSessionRegistry.getOrCreate('finished', () => true).addStream('translate:finished')()

    tabSessionRegistry.sweep(new Set())

    expect(abortRequest).not.toHaveBeenCalled()
  })

  it('returns the same handle for an id already registered', () => {
    const first = tabSessionRegistry.getOrCreate('same', () => true)
    const secondRelease = vi.fn(() => true)
    const second = tabSessionRegistry.getOrCreate('same', secondRelease)

    expect(second).toBe(first)

    tabSessionRegistry.sweep(new Set())
    tabSessionRegistry.releaseUnreachable()
    expect(secondRelease).not.toHaveBeenCalled()
  })

  it('aborts a run started before the page remounted', () => {
    // The Stop button after a tab switch: this mount never started the run, so the id in the
    // session is the only handle on it.
    const handle = tabSessionRegistry.getOrCreate('cancel-me', () => true)
    handle.addStream('translate:cancel-me')

    handle.abortStreams()

    expect(abortRequest).toHaveBeenCalledExactlyOnceWith('ai.stream.abort', { topicId: 'translate:cancel-me' })
    expect(handle.isBusy()).toBe(false)
  })

  it('reports an unknown session as not busy', () => {
    expect(tabSessionRegistry.isBusy('never-registered')).toBe(false)
    expect(tabSessionRegistry.isBusy(undefined)).toBe(false)
  })
})
