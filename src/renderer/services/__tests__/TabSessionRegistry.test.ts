import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it, vi } from 'vitest'

import { collectLiveSessionIds, tabSessionIdFromUrl, tabSessionRegistry } from '../TabSessionRegistry'

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

describe('tabSessionIdFromUrl', () => {
  it('reads the session id a tab url carries', () => {
    expect(tabSessionIdFromUrl('/app/translate?tabSession=a')).toBe('a')
    expect(tabSessionIdFromUrl('/app/translate')).toBeUndefined()
  })

  it('ignores an agent conversation id, which names a database row rather than tab memory', () => {
    expect(tabSessionIdFromUrl('/app/agents?sessionId=agent-1')).toBeUndefined()
  })
})

/**
 * A stand-in for what a page contributes to its session. The registry knows only `isBusy` /
 * `cancel` / `release`; `addWork` is this owner's own vocabulary and must survive the round trip.
 */
function testOwner(release: () => boolean = () => true) {
  const cancelled: string[] = []
  const create = (notify: () => void) => {
    const work = new Set<string>()
    return {
      isBusy: () => work.size > 0,
      cancel: () => {
        cancelled.push(...work)
        work.clear()
        notify()
      },
      release,
      addWork: (workId: string) => {
        work.add(workId)
        notify()
        return () => {
          if (work.delete(workId)) notify()
        }
      }
    }
  }
  return { create, cancelled }
}

describe('tabSessionRegistry', () => {
  it("cancels the work of a session whose tab is gone, and leaves an open tab's alone", () => {
    const gone = testOwner()
    const open = testOwner()
    tabSessionRegistry.getOrCreate('gone', gone.create).addWork('work-1')
    tabSessionRegistry.getOrCreate('open', open.create).addWork('work-2')

    tabSessionRegistry.sweep(new Set(['open']))

    expect(gone.cancelled).toEqual(['work-1'])
    expect(open.cancelled).toEqual([])
  })

  it("hands back the owner's own methods, which the registry never sees", () => {
    // The registry's contract is three methods; everything else a page needs rides along untouched.
    const handle = tabSessionRegistry.getOrCreate('vocabulary', testOwner().create)

    const finish = handle.addWork('work')
    expect(handle.isBusy()).toBe(true)
    finish()
    expect(handle.isBusy()).toBe(false)
  })

  it('does not release a session in the same pass that finds it unreachable', () => {
    // A tab's url stops naming its session before the page rendering it unmounts, so releasing
    // here would drop cache keys a mounted `useCache` still holds (#20074).
    const release = vi.fn(() => true)
    tabSessionRegistry.getOrCreate('deferred', testOwner(release).create)

    tabSessionRegistry.sweep(new Set())
    expect(release).not.toHaveBeenCalled()
    expect(tabSessionRegistry.get('deferred')).toBeDefined()

    tabSessionRegistry.releaseUnreachable()
    expect(release).toHaveBeenCalledOnce()
    expect(tabSessionRegistry.get('deferred')).toBeUndefined()
  })

  it('never releases a session whose tab is still open', () => {
    const release = vi.fn(() => true)
    tabSessionRegistry.getOrCreate('kept', testOwner(release).create)

    tabSessionRegistry.sweep(new Set(['kept']))
    tabSessionRegistry.releaseUnreachable()

    expect(release).not.toHaveBeenCalled()
    expect(tabSessionRegistry.get('kept')).toBeDefined()
  })

  it('stops treating a session as unreachable once a tab names it again', () => {
    // The mark is the latest sweep's verdict. Latched, it would release the draft of a live page
    // and cancel its work on every later sweep — silently, forever.
    const release = vi.fn(() => true)
    const owner = testOwner(release)
    const handle = tabSessionRegistry.getOrCreate('returning', owner.create)
    handle.addWork('run-1')

    tabSessionRegistry.sweep(new Set())
    tabSessionRegistry.sweep(new Set(['returning']))
    handle.addWork('run-2')
    tabSessionRegistry.releaseUnreachable()

    expect(release).not.toHaveBeenCalled()
    expect(tabSessionRegistry.get('returning')?.isBusy()).toBe(true)
    expect(owner.cancelled).toEqual(['run-1'])
  })

  it('keeps a session whose release was refused, and tries again on the next pass', () => {
    // The cache refuses to drop a key its hook still reads — dropping the session here would
    // leak the entry for good.
    let releasable = false
    const release = vi.fn(() => releasable)
    tabSessionRegistry.getOrCreate('retry-me', testOwner(release).create)

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
    tabSessionRegistry.getOrCreate('throwing', testOwner(release).create)

    tabSessionRegistry.sweep(new Set())
    tabSessionRegistry.releaseUnreachable()
    tabSessionRegistry.releaseUnreachable()

    expect(release).toHaveBeenCalledOnce()
    expect(tabSessionRegistry.get('throwing')).toBeUndefined()
  })

  it('reports busy from the owner, for a session the caller never held', () => {
    // The sidebar asks the registry, at a moment when the page owning the session is unmounted.
    const handle = tabSessionRegistry.getOrCreate('busy-check', testOwner().create)
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(false)

    const finish = handle.addWork('work')
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(true)

    finish()
    expect(tabSessionRegistry.isBusy('busy-check')).toBe(false)
  })

  it('does not cancel finished work when the session is later released', () => {
    const owner = testOwner()
    tabSessionRegistry.getOrCreate('finished', owner.create).addWork('work')()

    tabSessionRegistry.sweep(new Set())

    expect(owner.cancelled).toEqual([])
  })

  it('returns the same handle for an id already registered', () => {
    const first = tabSessionRegistry.getOrCreate('same', testOwner().create)
    const secondRelease = vi.fn(() => true)
    const second = tabSessionRegistry.getOrCreate('same', testOwner(secondRelease).create)

    expect(second).toBe(first)

    tabSessionRegistry.sweep(new Set())
    tabSessionRegistry.releaseUnreachable()
    expect(secondRelease).not.toHaveBeenCalled()
  })

  it('cancels work started before the page remounted', () => {
    // The Stop button after a tab switch: this mount started nothing, so the session is the only
    // handle on the run.
    const owner = testOwner()
    const handle = tabSessionRegistry.getOrCreate('cancel-me', owner.create)
    handle.addWork('work')

    handle.cancel()

    expect(owner.cancelled).toEqual(['work'])
    expect(handle.isBusy()).toBe(false)
  })

  it('reports an unknown session as not busy', () => {
    expect(tabSessionRegistry.isBusy('never-registered')).toBe(false)
    expect(tabSessionRegistry.isBusy(undefined)).toBe(false)
  })
})
