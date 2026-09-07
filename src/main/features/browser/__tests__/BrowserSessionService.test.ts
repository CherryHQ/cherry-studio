import { EventEmitter } from 'node:events'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { app, session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserSessionService } from '../BrowserSessionService'
import { createGuest } from './guestFixture'

let events: EventEmitter
let service: BrowserSessionService
beforeEach(async () => {
  events = new EventEmitter()
  vi.spyOn(app, 'on').mockImplementation((event, listener) => {
    events.on(event, listener)
    return app
  })
  vi.spyOn(app, 'removeListener').mockImplementation((event, listener) => {
    events.removeListener(event, listener)
    return app
  })
  vi.useFakeTimers()
  BaseService.resetInstances()
  service = new BrowserSessionService()
  await service._doInit()
})
afterEach(async () => {
  await service._doStop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Browser session ownership', () => {
  it('releases a borrowed debugger only after the last consumer and never closes the page', async () => {
    const { guest, mock } = createGuest()
    const session = service.acquire(guest, 'annotation', { ownership: 'borrowed' })
    expect(service.acquire(guest, 'another', { ownership: 'borrowed' })).toBe(session)
    await session.send('Runtime.enable')
    service.release(guest, 'annotation')
    expect(session.isAvailable()).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(service.get(guest.id)).toBe(session)
    expect(() => service.acquire(guest, 'mcp', { ownership: 'managed', close: mock.close })).toThrow('not_allowed')
    service.release(guest, 'another')
    expect(service.get(guest.id)).toBeUndefined()
    expect(mock.debugger.isAttached()).toBe(false)
    expect(mock.isDestroyed()).toBe(false)
  })

  it('evicts the oldest temporary managed tab without counting borrowed pages', async () => {
    const managed = Array.from({ length: 5 }, (_, i) => createGuest(i + 1))
    for (let i = 0; i < 12; i++) service.acquire(createGuest(100 + i).guest, 'owner', { ownership: 'borrowed' })
    for (const { guest, mock } of managed) {
      service.acquire(guest, 'owner', { ownership: 'managed', close: mock.close })
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(managed[0].mock.isDestroyed()).toBe(true)
    expect(managed.slice(1).every(({ mock }) => !mock.isDestroyed())).toBe(true)
    expect(service.get(100)).toBeDefined()
  })

  it('rejects acquisitions when the global budget contains only deliverables', () => {
    for (let i = 0; i < 8; i++) {
      const { guest, mock } = createGuest(i)
      service.acquire(guest, `owner-${i}`, { ownership: 'managed', close: mock.close }).retention = 'deliverable'
    }
    const { guest, mock } = createGuest(9)
    expect(() => service.acquire(guest, 'new', { ownership: 'managed', close: mock.close })).toThrow('budget_exceeded')
    expect(Array.from({ length: 8 }, (_, i) => service.get(i))).not.toContain(undefined)
  })

  it('rejects a reentrant acquisition during shutdown', async () => {
    const first = createGuest(1)
    const second = createGuest(2)
    let rejected = false
    service.acquire(first.guest, 'owner', {
      ownership: 'managed',
      close: () => {
        try {
          service.acquire(second.guest, 'owner', { ownership: 'borrowed' })
        } catch {
          rejected = true
        }
        first.mock.close()
      }
    })
    await service._doStop()
    expect(rejected).toBe(true)
    expect(service.get(2)).toBeUndefined()
    expect(second.mock.listenerCount('destroyed')).toBe(0)
  })

  it('reclaims idle temporary tabs on a real lifecycle timer and cleans up at stop', async () => {
    const temporary = createGuest(1)
    const retained = createGuest(2)
    const borrowed = createGuest(3)
    service.acquire(temporary.guest, 'owner', { ownership: 'managed', close: temporary.mock.close })
    service.acquire(retained.guest, 'owner', { ownership: 'managed', close: retained.mock.close }).retention =
      'deliverable'
    service.acquire(borrowed.guest, 'owner', { ownership: 'borrowed' })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(temporary.mock.isDestroyed()).toBe(true)
    expect(retained.mock.isDestroyed()).toBe(false)
    expect(borrowed.mock.isDestroyed()).toBe(false)
    await service._doStop()
    expect(retained.mock.isDestroyed()).toBe(true)
    expect(borrowed.mock.isDestroyed()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(borrowed.mock.listenerCount('destroyed')).toBe(0)
  })
})

describe('Ordinary browser popup lifecycle', () => {
  it('handles guests from any host and stops opening tabs after service shutdown', async () => {
    const { guest, mock } = createGuest(500)
    let handler!: Parameters<Electron.WebContents['setWindowOpenHandler']>[0]
    Object.assign(mock, {
      getType: () => 'webview',
      session: session.fromPartition('persist:agent-browser'),
      isLoadingMainFrame: () => true,
      setWindowOpenHandler: (next: typeof handler) => {
        handler = next
      }
    })
    events.emit('web-contents-created', {}, guest)
    const url = 'https://www.bilibili.com/video/BV1Satr6zETw/?p=2#part'
    const openTab = vi.mocked(application.get('MainWindowService').openBrowserTab)
    openTab.mockClear()
    expect(handler({ url } as Electron.HandlerDetails)).toEqual({ action: 'deny' })
    expect(openTab).toHaveBeenCalledWith(url)
    openTab.mockClear()
    await service._doStop()
    expect(handler({ url } as Electron.HandlerDetails)).toEqual({ action: 'deny' })
    expect(openTab).not.toHaveBeenCalled()
    expect(mock.isDestroyed()).toBe(false)
  })
})
