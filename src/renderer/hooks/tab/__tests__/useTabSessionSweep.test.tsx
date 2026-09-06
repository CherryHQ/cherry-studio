import { tabSessionRegistry } from '@renderer/services/TabSessionRegistry'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) } }))

import { useTabSessionSweep } from '../useTabSessionSweep'

const routeTab = (sessionId: string): Tab => ({
  id: sessionId,
  type: 'route',
  url: `/app/translate?tabSession=${sessionId}`,
  title: ''
})

let seq = 0
const newSessionId = () => `sweep-${(seq += 1)}`

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTabSessionSweep', () => {
  it('waits for the outgoing page to unmount before dropping the session state', () => {
    // A tab's url stops naming its session before the page rendering it unmounts, so releasing in
    // the same pass would hit `useCache` hooks that are still registered (#20074).
    const id = newSessionId()
    const release = vi.fn(() => true)
    tabSessionRegistry.getOrCreate(id, release)

    renderHook(({ tabs }) => useTabSessionSweep(tabs), { initialProps: { tabs: [] as Tab[] } })

    expect(release).not.toHaveBeenCalled()

    act(() => {
      vi.runAllTimers()
    })

    expect(release).toHaveBeenCalledOnce()
  })

  it('never releases a session an open tab still refers to', () => {
    const id = newSessionId()
    const release = vi.fn(() => true)
    tabSessionRegistry.getOrCreate(id, release)

    renderHook(({ tabs }) => useTabSessionSweep(tabs), { initialProps: { tabs: [routeTab(id)] } })
    act(() => {
      vi.runAllTimers()
    })

    expect(release).not.toHaveBeenCalled()
  })

  it('retries a release the cache refused, without a timer of its own', () => {
    const id = newSessionId()
    let releasable = false
    const release = vi.fn(() => releasable)
    tabSessionRegistry.getOrCreate(id, release)

    const { rerender } = renderHook(({ tabs }) => useTabSessionSweep(tabs), {
      initialProps: { tabs: [] as Tab[] }
    })
    act(() => {
      vi.runAllTimers()
    })
    expect(tabSessionRegistry.get(id)).toBeDefined()

    releasable = true
    rerender({ tabs: [] })
    act(() => {
      vi.runAllTimers()
    })

    expect(tabSessionRegistry.get(id)).toBeUndefined()
  })
})
