import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workers: [] as Worker[], liveAtSpawn: [] as number[], fail: false }))

vi.mock('../attachmentWorker?nodeWorker', () => ({
  default: () => {
    const worker = new Worker(
      state.fail
        ? "throw new Error('decode failed')"
        : "require('node:worker_threads').parentPort.on('message', () => require('node:worker_threads').parentPort.postMessage({ type: 'result', value: [4] }))",
      { eval: true }
    )
    state.workers.push(worker)
    state.liveAtSpawn.push(state.workers.filter((item) => item.threadId !== -1).length)
    return worker
  }
}))

import { runAttachmentWorker } from '../attachmentWorkerClient'

afterEach(async () => {
  await Promise.all(state.workers.map((worker) => worker.terminate()))
  state.workers = []
  state.liveAtSpawn = []
  state.fail = false
})

describe('attachment worker lifetime', () => {
  it('returns a result after releasing the worker', async () => {
    const result = runAttachmentWorker('allocate', { bodies: ['text'], tokens: 4 })
    await vi.waitFor(() => expect(state.workers.length).toBe(1))
    state.workers[0].postMessage('finish')
    await expect(result).resolves.toEqual([4])
    expect(state.workers[0].threadId).toBe(-1)
  })

  it('propagates child failure and releases its resources', async () => {
    state.fail = true
    await expect(runAttachmentWorker('decode', { content: new Uint8Array(), conservative: false })).rejects.toThrow(
      'decode failed'
    )
    expect(state.workers[0].threadId).toBe(-1)
  })

  it('cancels running and queued work without exceeding two live workers', async () => {
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const tasks = controllers.map((controller) =>
      runAttachmentWorker('allocate', { bodies: ['text'], tokens: 4 }, controller.signal).catch((error) => error)
    )
    await vi.waitFor(() => expect(state.workers.length).toBe(2))
    controllers[3].abort(new Error('cancel queued'))
    await expect(tasks[3]).resolves.toMatchObject({ message: 'cancel queued' })
    controllers[0].abort(new Error('cancel active'))
    await expect(tasks[0]).resolves.toMatchObject({ message: 'cancel active' })
    await vi.waitFor(() => expect(state.workers.length).toBe(3))
    expect(Math.max(...state.liveAtSpawn)).toBe(2)
    state.workers[1].postMessage('finish')
    state.workers[2].postMessage('finish')
    await Promise.all(tasks)
    expect(state.workers.every((worker) => worker.threadId === -1)).toBe(true)
  })
})
