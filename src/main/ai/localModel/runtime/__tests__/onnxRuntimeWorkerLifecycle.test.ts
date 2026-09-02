import { once } from 'node:events'
import { Worker } from 'node:worker_threads'

import { describe, expect, it } from 'vitest'

async function loadTransformersInWorker(): Promise<unknown> {
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads')

      try {
        const transformers = require('@huggingface/transformers')
        parentPort.postMessage({ hasPipeline: typeof transformers.pipeline === 'function' })
      } catch (error) {
        parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
      }
    `,
    { eval: true }
  )

  try {
    const [result] = await once(worker, 'message')
    return result
  } finally {
    await worker.terminate()
  }
}

describe('transformers worker lifecycle', () => {
  it('loads again after a worker using its ONNX native binding is terminated', async () => {
    await expect(loadTransformersInWorker()).resolves.toEqual({ hasPipeline: true })
    await expect(loadTransformersInWorker()).resolves.toEqual({ hasPipeline: true })
  })
})
