import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { FileObservationEvent } from '@shared/ipc/schemas/fileObservation'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileEditObservation } from '../FileEditObservation'

const ipc = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: ipc }))
let listeners: Set<(event: FileObservationEvent) => void>
let lease: { observationId: string; generation: string; sequence: number }
let disposed: string[]
beforeEach(() => {
  vi.useFakeTimers()
  listeners = new Set()
  disposed = []
  ipc.on.mockImplementation((_event, callback) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  })
  ipc.request.mockImplementation(async (route, input) => {
    if (route === 'file.observe.create') {
      lease = { observationId: crypto.randomUUID(), generation: crypto.randomUUID(), sequence: 0 }
      return lease
    }
    if (route === 'file.observe.activate') return true
    if (route === 'file.observe.dispose') {
      disposed.push(input.observationId)
      return
    }
    throw new Error(`Unexpected ${route}`)
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('shares coverage until its last subscriber leaves and fences old generations after reconnecting', async () => {
  const manager = new FileEditObservation()
  const root = AbsoluteFilePathSchema.parse('/notes')
  const updates: boolean[] = []
  const first = manager.subscribe(root, (active) => updates.push(active))
  const second = manager.subscribe(root, (active) => updates.push(active))
  await first.ready
  const old = lease
  first.dispose()
  for (const listener of listeners)
    listener({ ...old, sequence: 2, kind: 'invalidate', paths: ['/notes/a'], subtree: false })
  expect(updates.at(-1)).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(disposed).toEqual([old.observationId])
  expect(second.isActive()).toBe(true)
  const count = updates.length
  for (const listener of listeners)
    listener({ ...old, sequence: 3, kind: 'invalidate', paths: ['/notes/a'], subtree: false })
  expect(updates).toHaveLength(count)
  second.dispose()
  await Promise.resolve()
  expect(disposed).toContain(lease.observationId)
})

it('disposes a late subscription response without activating a released scope', async () => {
  const pending = Promise.withResolvers<{ observationId: string; generation: string; sequence: number }>()
  ipc.request.mockImplementationOnce(() => pending.promise)
  const manager = new FileEditObservation()
  const subscription = manager.subscribe(AbsoluteFilePathSchema.parse('/notes'), () => {
    throw new Error('Released listener invoked')
  })
  subscription.dispose()
  const late = { observationId: crypto.randomUUID(), generation: crypto.randomUUID(), sequence: 0 }
  pending.resolve(late)
  await subscription.ready
  await Promise.resolve()
  expect(disposed).toEqual([late.observationId])
  expect(subscription.isActive()).toBe(false)
})
