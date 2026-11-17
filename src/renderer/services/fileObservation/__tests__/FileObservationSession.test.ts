import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { FileObservationResource } from '@shared/ipc/schemas/fileObservation'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { fileObservationService } from '../FileObservationService'

const transport = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: transport }))
let opened: number
let closed: string[]
let listener: ((event: FileObservationResource) => void) | undefined

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  opened = 0
  closed = []
  transport.request.mockReset().mockImplementation(async (route: string, input: { subscriptionId: string }) => {
    if (route === 'file.observe.open')
      return { subscriptionId: `subscription-${++opened}`, revision: 0, coverage: 'live' }
    if (route === 'file.observe.activate') return true
    if (route === 'file.observe.close') {
      closed.push(input.subscriptionId)
      return
    }
    throw new Error(route)
  })
  transport.on.mockImplementation((_event: string, callback: typeof listener) => {
    listener = callback
    return () => {
      if (listener === callback) listener = undefined
    }
  })
})
afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

it('shares observation and reacquires one subscription through retained bindings after idle release', async () => {
  const handle = createFilePathHandle(AbsoluteFilePathSchema.parse('/registry/shared.txt'))
  const first = fileObservationService.get(handle)
  const second = fileObservationService.get(handle)
  const a = first.subscribe(() => {})
  const b = second.subscribe(() => {})
  await first.whenReady()
  expect(opened).toBe(1)
  a()
  listener?.({ subscriptionId: 'subscription-1', revision: 1, coverage: 'live' })
  expect(second.getSnapshot().coverage).toBe('live')
  expect(closed).toEqual([])
  b()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(closed).toEqual(['subscription-1'])
  const c = first.subscribe(() => {})
  const d = fileObservationService.get(handle).subscribe(() => {})
  await first.whenReady()
  expect(opened).toBe(2)
  c()
  d()
})

it('reconnects lost coverage and ignores notifications from the retired subscription', async () => {
  const reference = fileObservationService.get(
    createFilePathHandle(AbsoluteFilePathSchema.parse('/registry/recovery.txt'))
  )
  const release = reference.subscribe(() => {})
  await reference.whenReady()
  const obsolete = listener
  listener?.({ subscriptionId: 'subscription-1', revision: 1, coverage: 'unavailable' })
  await vi.waitFor(() => expect(opened).toBe(2))
  await reference.whenReady()
  const current = reference.getSnapshot()
  obsolete?.({ subscriptionId: 'subscription-1', revision: 2, coverage: 'unavailable' })
  expect(reference.getSnapshot()).toBe(current)
  expect(current.coverage).toBe('live')
  release()
})

it('exposes acquisition failure and retries on focus without restarting the renderer', async () => {
  transport.request.mockRejectedValueOnce(new Error('Watcher unavailable'))
  const reference = fileObservationService.get(
    createFilePathHandle(AbsoluteFilePathSchema.parse('/registry/retry.txt'))
  )
  const release = reference.subscribe(() => {})
  await expect(reference.whenReady()).rejects.toThrow('Watcher unavailable')
  expect(reference.getSnapshot().coverage).toBe('unavailable')
  window.dispatchEvent(new Event('focus'))
  await reference.whenReady()
  expect(reference.getSnapshot().coverage).toBe('live')
  release()
})

it('lets a manual refresh reconnect unavailable observation without a window focus event', async () => {
  transport.request.mockRejectedValueOnce(new Error('Watcher unavailable'))
  const reference = fileObservationService.get(
    createFilePathHandle(AbsoluteFilePathSchema.parse('/registry/manual.txt'))
  )
  const release = reference.subscribe(() => {})
  await expect(reference.whenReady()).rejects.toThrow('Watcher unavailable')
  await reference.refresh()
  expect(reference.getSnapshot().coverage).toBe('live')
  const version = reference.getSnapshot().version
  await reference.refresh()
  expect(reference.getSnapshot().version).toBeGreaterThan(version)
  release()
})
