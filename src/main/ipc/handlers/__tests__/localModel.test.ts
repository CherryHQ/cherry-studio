import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/localModel/LocalEmbeddingDownloadService', () => ({
  localEmbeddingDownloadService: {
    getStatus: vi.fn(),
    checkStatus: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock('@main/services/localModel/LocalOcrDownloadService', () => ({
  localOcrDownloadService: {
    getStatus: vi.fn(),
    checkStatus: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock('@main/services/localModel/OnnxRuntimeBinaryService', () => ({
  onnxRuntimeBinaryService: { removeIfUnused: vi.fn() }
}))

const { localEmbeddingDownloadService } = await import('@main/services/localModel/LocalEmbeddingDownloadService')
const { localOcrDownloadService } = await import('@main/services/localModel/LocalOcrDownloadService')
const { onnxRuntimeBinaryService } = await import('@main/services/localModel/OnnxRuntimeBinaryService')
const { localModelHandlers } = await import('../localModel')

const ctx = { senderId: 'w1' }

describe('localModelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('get_status/download/cancel dispatch to the owning service', async () => {
    // get_status goes through the async checkStatus (registration self-heal),
    // not the plain disk probe.
    vi.mocked(localEmbeddingDownloadService.checkStatus).mockResolvedValue('ready')

    await localModelHandlers['local_model.get_status']({ model: 'embedding' }, ctx)
    await localModelHandlers['local_model.download']({ model: 'ocr' }, ctx)
    await localModelHandlers['local_model.cancel']({ model: 'embedding' }, ctx)

    expect(localEmbeddingDownloadService.checkStatus).toHaveBeenCalled()
    expect(localOcrDownloadService.download).toHaveBeenCalled()
    expect(localEmbeddingDownloadService.cancel).toHaveBeenCalled()
  })

  describe('download', () => {
    it('does not touch the onnxruntime binary when the download succeeds', async () => {
      vi.mocked(localEmbeddingDownloadService.download).mockResolvedValue(undefined)

      await localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)

      expect(onnxRuntimeBinaryService.removeIfUnused).not.toHaveBeenCalled()
    })

    it('drops the shared onnxruntime binary when a download is cancelled and the sibling has no model', async () => {
      const abortError = new Error('download cancelled')
      vi.mocked(localEmbeddingDownloadService.download).mockRejectedValue(abortError)
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('not_downloaded')

      await expect(localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)).rejects.toBe(abortError)

      expect(onnxRuntimeBinaryService.removeIfUnused).toHaveBeenCalledWith(false)
    })

    it('keeps the shared onnxruntime binary when the sibling is mid-download (it may await the same coalesced ensure)', async () => {
      vi.mocked(localEmbeddingDownloadService.download).mockRejectedValue(new Error('download cancelled'))
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('downloading')

      await expect(localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)).rejects.toThrow()

      expect(onnxRuntimeBinaryService.removeIfUnused).toHaveBeenCalledWith(true)
    })

    it('propagates the original download error even when the binary cleanup itself fails', async () => {
      const downloadError = new Error('network down')
      vi.mocked(localOcrDownloadService.download).mockRejectedValue(downloadError)
      vi.mocked(localEmbeddingDownloadService.getStatus).mockReturnValue('not_downloaded')
      vi.mocked(onnxRuntimeBinaryService.removeIfUnused).mockRejectedValueOnce(new Error('EBUSY'))

      await expect(localModelHandlers['local_model.download']({ model: 'ocr' }, ctx)).rejects.toBe(downloadError)
    })
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
