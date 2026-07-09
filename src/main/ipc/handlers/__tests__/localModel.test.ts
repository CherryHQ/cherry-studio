import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/features/localModel/LocalEmbeddingDownloadService', () => ({
  localEmbeddingDownloadService: {
    getStatus: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock('@main/features/localModel/LocalOcrDownloadService', () => ({
  localOcrDownloadService: {
    getStatus: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock('@main/features/localModel/OnnxRuntimeBinaryService', () => ({
  onnxRuntimeBinaryService: { removeIfUnused: vi.fn() }
}))

const { localEmbeddingDownloadService } = await import('@main/features/localModel/LocalEmbeddingDownloadService')
const { localOcrDownloadService } = await import('@main/features/localModel/LocalOcrDownloadService')
const { onnxRuntimeBinaryService } = await import('@main/features/localModel/OnnxRuntimeBinaryService')
const { localModelHandlers } = await import('../localModel')

const ctx = { senderId: 'w1' }

describe('localModelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('get_status/download/cancel dispatch to the owning service', async () => {
    vi.mocked(localEmbeddingDownloadService.getStatus).mockReturnValue('ready')

    await localModelHandlers['local_model.get_status']({ model: 'embedding' }, ctx)
    await localModelHandlers['local_model.download']({ model: 'ocr' }, ctx)
    await localModelHandlers['local_model.cancel']({ model: 'embedding' }, ctx)

    expect(localEmbeddingDownloadService.getStatus).toHaveBeenCalled()
    expect(localOcrDownloadService.download).toHaveBeenCalled()
    expect(localEmbeddingDownloadService.cancel).toHaveBeenCalled()
  })

  describe('remove', () => {
    it('removes the shared onnxruntime binary once the sibling feature is also gone', async () => {
      vi.mocked(localEmbeddingDownloadService.remove).mockResolvedValue({ removed: true })
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('not_downloaded')

      const result = await localModelHandlers['local_model.remove']({ model: 'embedding' }, ctx)

      expect(onnxRuntimeBinaryService.removeIfUnused).toHaveBeenCalledWith(false)
      expect(result).toEqual({ removed: true })
    })

    it('keeps the shared onnxruntime binary while the sibling feature still has a model', async () => {
      vi.mocked(localOcrDownloadService.remove).mockResolvedValue({ removed: true })
      vi.mocked(localEmbeddingDownloadService.getStatus).mockReturnValue('ready')

      await localModelHandlers['local_model.remove']({ model: 'ocr' }, ctx)

      expect(onnxRuntimeBinaryService.removeIfUnused).toHaveBeenCalledWith(true)
    })

    it('does not touch the onnxruntime binary when the feature itself was kept', async () => {
      vi.mocked(localEmbeddingDownloadService.remove).mockResolvedValue({ removed: false })

      const result = await localModelHandlers['local_model.remove']({ model: 'embedding' }, ctx)

      expect(onnxRuntimeBinaryService.removeIfUnused).not.toHaveBeenCalled()
      expect(result).toEqual({ removed: false })
    })
  })
})
