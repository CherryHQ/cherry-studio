import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Worker, WorkerOptions } from 'node:worker_threads'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

const { state } = vi.hoisted(() => {
  const workers: Worker[] = []
  return { state: { gate: new SharedArrayBuffer(8), exits: 0, workers } }
})
beforeEach(() => {
  state.gate = new SharedArrayBuffer(8)
  state.exits = 0
  state.workers.length = 0
})

vi.mock('../watcherWorker?nodeWorker', async () => {
  const { Worker } = await import('node:worker_threads')
  return {
    default: (options: WorkerOptions) => {
      const worker = new Worker(
        `
        require('tsx/cjs')
        require.cache[require.resolve('chokidar')] = {
          exports: require('./src/main/services/file/__tests__/fixtures/slowWatcher.cjs')
        }
        require('./src/main/services/file/watcherWorker.ts')
      `,
        {
          ...options,
          eval: true,
          workerData: { ...options.workerData, closeGate: state.gate }
        }
      )
      state.workers.push(worker)
      worker.once('exit', () => state.exits++)
      return worker
    }
  }
})

import { createDirectoryWatcher, DirectoryWatcherHost } from '../watcher'

// Catches synchronous native disposal on Main, premature close receipts, and orphaned workers.
describe('watcher shutdown isolation', () => {
  it('keeps the caller responsive until native close completes and the worker exits', async () => {
    const gate = new Int32Array(state.gate)
    const host = new DirectoryWatcherHost()
    const watcher = createDirectoryWatcher(AbsoluteFilePathSchema.parse(process.cwd()), {}, host)
    await new Promise<void>((resolve) => {
      watcher.onEvent((event) => {
        if (event.kind === 'ready') resolve()
      })
    })
    let completed = false
    const closing = watcher.close().then(() => {
      completed = true
    })
    try {
      await vi.waitFor(() => expect(Atomics.load(gate, 0)).toBe(1))
      await nextTurn()
      expect(completed).toBe(false)
      expect(state.exits).toBe(0)
      expect(watcher.close()).toBe(watcher.close())
    } finally {
      Atomics.store(gate, 1, 1)
      Atomics.notify(gate, 1)
      await closing
      await host.close()
    }
    expect(completed).toBe(true)
    expect(state.exits).toBe(1)
  })
})

it('shares one thread between scopes and preserves another scope when one is closed', async () => {
  const host = new DirectoryWatcherHost()
  Atomics.store(new Int32Array(state.gate), 1, 1)
  const root = AbsoluteFilePathSchema.parse(process.cwd())
  const first = createDirectoryWatcher(root, {}, host)
  const second = createDirectoryWatcher(root, {}, host)
  const ready = new Promise<void>((resolve) =>
    second.onEvent((event) => {
      if (event.kind === 'ready') resolve()
    })
  )
  try {
    await first.close()
    await ready
    expect(state.workers).toHaveLength(1)
    expect(state.exits).toBe(0)
  } finally {
    await host.close()
  }
  expect(state.exits).toBe(1)
})

it('reports lost coverage on worker exit and starts a replacement for a later acquisition', async () => {
  const host = new DirectoryWatcherHost()
  Atomics.store(new Int32Array(state.gate), 1, 1)
  const root = AbsoluteFilePathSchema.parse(process.cwd())
  const first = createDirectoryWatcher(root, {}, host)
  const unavailable = new Promise<void>((resolve) =>
    first.onEvent((event) => {
      if (event.kind === 'error') resolve()
    })
  )
  await new Promise<void>((resolve) =>
    first.onEvent((event) => {
      if (event.kind === 'ready') resolve()
    })
  )
  await state.workers[0].terminate()
  await unavailable
  await expect(first.close()).rejects.toThrow('exited unexpectedly')
  const second = createDirectoryWatcher(root, {}, host)
  try {
    await new Promise<void>((resolve) =>
      second.onEvent((event) => {
        if (event.kind === 'ready') resolve()
      })
    )
    expect(state.workers).toHaveLength(2)
  } finally {
    await host.close()
  }
  expect(state.exits).toBe(2)
})
