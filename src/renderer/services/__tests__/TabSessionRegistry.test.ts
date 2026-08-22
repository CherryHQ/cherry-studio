import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it, vi } from 'vitest'

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
  it('keeps a session whose tab is still open, and releases one whose tab is gone', () => {
    const kept = vi.fn()
    const dropped = vi.fn()
    tabSessionRegistry.getOrCreate('keep-me', () => {
      kept()
      return true
    })
    tabSessionRegistry.getOrCreate('drop-me', () => {
      dropped()
      return true
    })

    tabSessionRegistry.sweep(new Set(['keep-me']))

    expect(kept).not.toHaveBeenCalled()
    expect(dropped).toHaveBeenCalledOnce()
    expect(tabSessionRegistry.get('keep-me')).toBeDefined()
    expect(tabSessionRegistry.get('drop-me')).toBeUndefined()
  })

  it('aborts a task still in flight when its session is released', () => {
    const handle = tabSessionRegistry.getOrCreate('abort-me', () => true)
    const controller = new AbortController()
    handle.addTask(controller)

    tabSessionRegistry.sweep(new Set())

    expect(controller.signal.aborted).toBe(true)
  })

  it('leaves an in-flight task running while its tab is open', () => {
    // The regression behind #18885: switching tabs unmounts the page but must not cancel the run.
    const handle = tabSessionRegistry.getOrCreate('still-running', () => true)
    const controller = new AbortController()
    handle.addTask(controller)

    tabSessionRegistry.sweep(new Set(['still-running']))

    expect(controller.signal.aborted).toBe(false)
  })

  it('reports busy only while a task is unfinished', () => {
    const handle = tabSessionRegistry.getOrCreate('busy-check', () => true)
    expect(handle.isBusy()).toBe(false)

    const finish = handle.addTask(new AbortController())
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(true)

    finish()
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(false)
  })

  it('does not abort a finished task when the session is later released', () => {
    const handle = tabSessionRegistry.getOrCreate('finished', () => true)
    const controller = new AbortController()
    handle.addTask(controller)()

    tabSessionRegistry.sweep(new Set())

    expect(controller.signal.aborted).toBe(false)
  })

  it('returns the same handle for an id already registered', () => {
    const first = tabSessionRegistry.getOrCreate('same', () => true)
    const secondRelease = vi.fn(() => true)
    const second = tabSessionRegistry.getOrCreate('same', secondRelease)

    expect(second).toBe(first)

    tabSessionRegistry.sweep(new Set())
    expect(secondRelease).not.toHaveBeenCalled()
  })

  it('keeps a session whose release could not finish, and retries it on the next sweep', () => {
    // A page unmounts asynchronously after its tab navigates away, and the cache refuses to drop
    // a key its hook still reads — dropping the session here would leak the entry for good.
    let releasable = false
    const release = vi.fn(() => releasable)
    tabSessionRegistry.getOrCreate('retry-me', release)

    expect(tabSessionRegistry.sweep(new Set())).toBe(1)
    expect(tabSessionRegistry.get('retry-me')).toBeDefined()

    releasable = true
    expect(tabSessionRegistry.sweep(new Set())).toBe(0)
    expect(tabSessionRegistry.get('retry-me')).toBeUndefined()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it("aborts an unreachable session's tasks even when its release is deferred", () => {
    const controller = new AbortController()
    const handle = tabSessionRegistry.getOrCreate('deferred-abort', () => false)
    handle.addTask(controller)

    tabSessionRegistry.sweep(new Set())

    expect(controller.signal.aborted).toBe(true)
  })

  it('abortTasks cancels a run started before the page remounted', () => {
    // The Stop button after a tab switch: this mount never held the controller.
    const handle = tabSessionRegistry.getOrCreate('cancel-me', () => true)
    const controller = new AbortController()
    handle.addTask(controller)

    handle.abortTasks()

    expect(controller.signal.aborted).toBe(true)
    expect(handle.isBusy()).toBe(false)
  })

  it('reports an unknown session as not busy', () => {
    expect(tabSessionRegistry.isBusy('never-registered')).toBe(false)
    expect(tabSessionRegistry.isBusy(undefined)).toBe(false)
  })
})
