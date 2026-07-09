import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InferenceModelSource } from '../inferenceProtocol'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  unref = vi.fn()
  terminate = vi.fn(async () => 0)
}

const WorkerCtor = vi.fn(() => new FakeWorker())

vi.mock('node:worker_threads', () => ({
  Worker: WorkerCtor
}))

// Intel Mac: onnxruntime-node ships no darwin-x64 binding — the single worker
// spawn point must refuse before it ever constructs a Worker.
vi.mock('@main/core/platform', () => ({ isDarwinX64: true }))

const { EmbeddingInferenceService } = await import('../EmbeddingInferenceService')
const { OcrInferenceService } = await import('../OcrInferenceService')
const embeddingInferenceService = new EmbeddingInferenceService()
const ocrInferenceService = new OcrInferenceService()

const SOURCE: InferenceModelSource = {
  remoteHost: 'https://huggingface.co',
  remotePathTemplate: '{model}/resolve/{revision}',
  revision: 'main'
}

describe('InferenceService on darwin-x64', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects embed without spawning a worker', async () => {
    await expect(embeddingInferenceService.embed(['hi'], SOURCE, 'org/model', 'q8')).rejects.toThrow(/darwin x64/)
    expect(WorkerCtor).not.toHaveBeenCalled()
  })

  it('rejects loadEmbedding without spawning a worker', async () => {
    await expect(embeddingInferenceService.loadEmbedding(SOURCE, 'org/model', 'q8')).rejects.toThrow(/darwin x64/)
    expect(WorkerCtor).not.toHaveBeenCalled()
  })

  it('rejects recognize (OCR) without spawning a worker', async () => {
    await expect(
      ocrInferenceService.recognize({ detection: '/a', recognition: '/b', charactersDictionary: '/c' }, '/img.png')
    ).rejects.toThrow(/darwin x64/)
    expect(WorkerCtor).not.toHaveBeenCalled()
  })
})
