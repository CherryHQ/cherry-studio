import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { application } from '@application'

import { GuestSession } from '../session/GuestSession'
import { createGuest } from './guestFixture'

const sessions: GuestSession[] = []
const defaultGetPath = vi.mocked(application.getPath).getMockImplementation()!
let workspace = ''
beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'mcp-workspace-'))
  vi.mocked(application.getPath).mockImplementation((key, filename) =>
    key === 'feature.mcp.workspace' ? path.join(workspace, filename ?? '') : defaultGetPath(key, filename)
  )
})
afterEach(() => {
  vi.mocked(application.getPath).mockImplementation(defaultGetPath)
  rmSync(workspace, { recursive: true, force: true })
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
  const item = Object.assign(new EventEmitter(), { getFilename: () => 'report.txt', setSavePath: vi.fn() })
  a.mock.session.emit('will-download', {}, item, a.guest)
  expect(item.setSavePath).toHaveBeenCalledWith(path.join(workspace, 'report.txt'))
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

it('keeps managed download filenames inside the MCP workspace', () => {
  const a = createGuest()
  const session = new GuestSession(a.guest, 'managed')
  sessions.push(session)
  const item = Object.assign(new EventEmitter(), { getFilename: () => '../report.txt', setSavePath: vi.fn() })

  a.mock.session.emit('will-download', {}, item, a.guest)

  expect(item.setSavePath).toHaveBeenCalledWith(path.join(workspace, 'report.txt'))
  expect(session.takeEvents()).toEqual({ downloads: [{ filename: 'report.txt', state: 'progressing' }] })
})

it('never replaces an existing or in-flight workspace file with a managed download', () => {
  writeFileSync(path.join(workspace, 'report.txt'), 'original')
  const a = createGuest()
  const session = new GuestSession(a.guest, 'managed')
  sessions.push(session)
  const make = () => Object.assign(new EventEmitter(), { getFilename: () => 'report.txt', setSavePath: vi.fn() })
  const first = make()
  const second = make()

  a.mock.session.emit('will-download', {}, first, a.guest)
  a.mock.session.emit('will-download', {}, second, a.guest)

  expect(first.setSavePath).toHaveBeenCalledWith(path.join(workspace, 'report (1).txt'))
  expect(second.setSavePath).toHaveBeenCalledWith(path.join(workspace, 'report (2).txt'))
  expect(readFileSync(path.join(workspace, 'report.txt'), 'utf8')).toBe('original')
  expect(session.takeEvents()).toEqual({
    downloads: [
      { filename: 'report (1).txt', state: 'progressing' },
      { filename: 'report (2).txt', state: 'progressing' }
    ]
  })
})

it('releases the reserved placeholder when a managed download does not complete', () => {
  const a = createGuest()
  const session = new GuestSession(a.guest, 'managed')
  sessions.push(session)
  const item = Object.assign(new EventEmitter(), { getFilename: () => 'report.txt', setSavePath: vi.fn() })

  a.mock.session.emit('will-download', {}, item, a.guest)
  expect(existsSync(path.join(workspace, 'report.txt'))).toBe(true)
  item.emit('done', {}, 'cancelled')

  expect(existsSync(path.join(workspace, 'report.txt'))).toBe(false)
})

it('does not redirect borrowed guest downloads to the MCP workspace', async () => {
  const a = createGuest()
  const session = new GuestSession(a.guest, 'borrowed')
  sessions.push(session)
  const observer = await session.observe()
  const item = Object.assign(new EventEmitter(), { getFilename: () => 'report.txt', setSavePath: vi.fn() })

  a.mock.session.emit('will-download', {}, item, a.guest)

  expect(item.setSavePath).not.toHaveBeenCalled()
  observer.dispose()
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
