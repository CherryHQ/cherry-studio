import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  unref = vi.fn()
  terminate = vi.fn(async () => 0)
}

const WorkerCtor = vi.fn(() => new FakeWorker())

vi.mock('node:worker_threads', () => ({
  Worker: WorkerCtor
}))

// Intel Mac is represented by the catalog artifact matrix: onnxruntime-node has no
// darwin-x64 leaf, so the shared spawn point refuses before constructing a Worker.
vi.mock('../../installation/LocalModelStorageService', () => ({
  localModelStorageService: {
    resolveInstalledDir: () => '/models/local',
    isArtifactReady: () => true,
    isArtifactSupported: () => false,
    artifactPath: () => '/missing'
  }
}))

const { EmbeddingInferenceService } = await import('../../capabilities/embedding/EmbeddingInferenceService')
const { OcrInferenceService } = await import('../../capabilities/ocr/OcrInferenceService')
const embeddingInferenceService = new EmbeddingInferenceService()
const ocrInferenceService = new OcrInferenceService()

describe('InferenceService on darwin-x64', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects embed without spawning a worker', async () => {
    await expect(embeddingInferenceService.embed(['hi'])).rejects.toThrow(/not supported.*onnxruntime-node/i)
    expect(WorkerCtor).not.toHaveBeenCalled()
  })

  it('rejects countTokens without spawning a worker', async () => {
    await expect(embeddingInferenceService.countTokens(['hi'])).rejects.toThrow(/not supported.*onnxruntime-node/i)
    expect(WorkerCtor).not.toHaveBeenCalled()
  })

  it('rejects recognize (OCR) without spawning a worker', async () => {
    await expect(ocrInferenceService.recognize({ kind: 'path', imagePath: '/img.png' })).rejects.toThrow(
      /not supported.*onnxruntime-node/i
    )
    expect(WorkerCtor).not.toHaveBeenCalled()
  })
})
