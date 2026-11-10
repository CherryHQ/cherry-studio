import { EventEmitter } from 'node:events'

import { afterEach, expect, it, vi } from 'vitest'

import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
afterEach(() => {
  for (const session of sessions) session.dispose()
  sessions.length = 0
  vi.useRealTimers()
})

it('attributes shared-partition downloads to one guest, reports updates once, and removes listeners', () => {
  const a = createGuest(1)
  const b = createGuest(2)
  b.mock.session = a.mock.session
  const first = new GuestSession(a.guest, 'managed')
  const second = new GuestSession(b.guest, 'managed')
  sessions.push(first, second)
  const item = Object.assign(new EventEmitter(), { getFilename: () => 'report.txt' })
  a.mock.session.emit('will-download', {}, item, a.guest)
  expect(first.busy).toBe(true)
  expect(second.takeEvents()).toEqual({})
  expect(first.takeEvents()).toEqual({ downloads: [{ filename: 'report.txt', state: 'progressing' }] })
  expect(first.takeEvents()).toEqual({})
  item.emit('done', {}, 'completed')
  expect(first.takeEvents()).toEqual({ downloads: [{ filename: 'report.txt', state: 'completed' }] })
  expect(first.busy).toBe(false)
  expect(item.listenerCount('updated')).toBe(0)
  first.dispose()
  second.dispose()
  expect(a.mock.session.listenerCount('will-download')).toBe(0)
})

it('reports a managed dialog timeout once while borrowed dialogs remain user-owned', async () => {
  vi.useFakeTimers()
  const a = createGuest(1)
  const b = createGuest(2)
  const managed = new GuestSession(a.guest, 'managed')
  const borrowed = new GuestSession(b.guest, 'borrowed')
  sessions.push(managed, borrowed)
  await managed.send('Runtime.enable')
  await borrowed.send('Runtime.enable')
  for (const guest of [a, b])
    guest.mock.debugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Continue?' })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(managed.takeEvents()).toEqual({ dismissedDialog: { type: 'confirm', message: 'Continue?' } })
  expect(managed.takeEvents()).toEqual({})
  expect(borrowed.pendingDialog).toEqual({ type: 'confirm', message: 'Continue?' })
})
