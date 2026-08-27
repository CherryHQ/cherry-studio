import { beforeEach, describe, expect, it, vi } from 'vitest'

const isLocalInferenceHardwareAccelerationSupported = vi.hoisted(() => vi.fn(() => true))

vi.mock('@main/ai/inference/inferenceAcceleration', () => ({
  isLocalInferenceHardwareAccelerationSupported
}))

vi.mock('@main/ai/localModel/registry/installers', () => ({
  localEmbeddingInstaller: {
    getStatus: vi.fn(),
    getStatusInfo: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock('@main/services/localModel/LocalOcrDownloadService', () => ({
  localOcrDownloadService: {
    getStatus: vi.fn(),
    getStatusInfo: vi.fn(),
    download: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn()
  }
}))

vi.mock('@main/ai/localModel/registry/LocalModelRegistry', () => ({
  localModelRegistry: { removeArtifact: vi.fn() }
}))

const { localEmbeddingInstaller } = await import('@main/ai/localModel/registry/installers')
const { localOcrDownloadService } = await import('@main/services/localModel/LocalOcrDownloadService')
const { localModelRegistry } = await import('@main/ai/localModel/registry/LocalModelRegistry')
const { localModelHandlers } = await import('../localModel')

const ctx = { senderId: 'w1' }

describe('localModelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('get_status/download/cancel dispatch to the owning service', async () => {
    vi.mocked(localEmbeddingInstaller.getStatusInfo).mockReturnValue({ status: 'ready' })
    vi.mocked(localOcrDownloadService.download).mockResolvedValue('ready')

    const status = await localModelHandlers['local_model.get_status']({ model: 'embedding' }, ctx)
    const result = await localModelHandlers['local_model.download']({ model: 'ocr' }, ctx)
    await localModelHandlers['local_model.cancel']({ model: 'embedding' }, ctx)

    expect(localEmbeddingInstaller.getStatusInfo).toHaveBeenCalled()
    expect(status).toEqual({ status: 'ready' })
    expect(localOcrDownloadService.download).toHaveBeenCalled()
    expect(result).toEqual({ result: 'ready' })
    expect(localEmbeddingInstaller.cancel).toHaveBeenCalled()
  })

  it('reports the main-process hardware acceleration capability', async () => {
    await expect(localModelHandlers['local_model.get_acceleration_capability'](undefined, ctx)).resolves.toEqual({
      supported: true
    })

    expect(isLocalInferenceHardwareAccelerationSupported).toHaveBeenCalledOnce()
  })

  describe('download', () => {
    it('does not touch the onnxruntime binary when the download succeeds', async () => {
      vi.mocked(localEmbeddingInstaller.download).mockResolvedValue('ready')

      await expect(localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)).resolves.toEqual({
        result: 'ready'
      })

      expect(localModelRegistry.removeArtifact).not.toHaveBeenCalled()
    })

    it('drops the shared onnxruntime binary when a download is cancelled and the sibling has no model', async () => {
      vi.mocked(localEmbeddingInstaller.download).mockResolvedValue('cancelled')
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('not_downloaded')

      await expect(localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)).resolves.toEqual({
        result: 'cancelled'
      })

      expect(localModelRegistry.removeArtifact).toHaveBeenCalledWith('onnxruntime-node')
    })

    it('keeps the shared onnxruntime binary when the sibling is mid-download (it may await the same coalesced ensure)', async () => {
      vi.mocked(localEmbeddingInstaller.download).mockResolvedValue('cancelled')
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('downloading')

      await expect(localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)).resolves.toEqual({
        result: 'cancelled'
      })

      expect(localModelRegistry.removeArtifact).not.toHaveBeenCalled()
    })

    it('does not turn a cancellation into a failure when shared binary cleanup fails', async () => {
      vi.mocked(localEmbeddingInstaller.download).mockResolvedValue('cancelled')
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('not_downloaded')
      vi.mocked(localModelRegistry.removeArtifact).mockRejectedValueOnce(new Error('EBUSY'))

      await expect(localModelHandlers['local_model.download']({ model: 'embedding' }, ctx)).resolves.toEqual({
        result: 'cancelled'
      })
    })

    it('propagates the original download error even when the binary cleanup itself fails', async () => {
      const downloadError = new Error('network down')
      vi.mocked(localOcrDownloadService.download).mockRejectedValue(downloadError)
      vi.mocked(localEmbeddingInstaller.getStatus).mockReturnValue('not_downloaded')
      vi.mocked(localModelRegistry.removeArtifact).mockRejectedValueOnce(new Error('EBUSY'))

      await expect(localModelHandlers['local_model.download']({ model: 'ocr' }, ctx)).rejects.toBe(downloadError)
    })
  })

  describe('remove', () => {
    it('removes the shared onnxruntime binary once the sibling feature is also gone', async () => {
      vi.mocked(localEmbeddingInstaller.remove).mockResolvedValue({ removed: true })
      vi.mocked(localOcrDownloadService.getStatus).mockReturnValue('not_downloaded')

      const result = await localModelHandlers['local_model.remove']({ model: 'embedding' }, ctx)

      expect(localModelRegistry.removeArtifact).toHaveBeenCalledWith('onnxruntime-node')
      expect(result).toEqual({ removed: true })
    })

    it('keeps the shared onnxruntime binary while the sibling feature still has a model', async () => {
      vi.mocked(localOcrDownloadService.remove).mockResolvedValue({ removed: true })
      vi.mocked(localEmbeddingInstaller.getStatus).mockReturnValue('ready')

      await localModelHandlers['local_model.remove']({ model: 'ocr' }, ctx)

      expect(localModelRegistry.removeArtifact).not.toHaveBeenCalled()
    })

    it('does not touch the onnxruntime binary when the feature itself was kept', async () => {
      vi.mocked(localEmbeddingInstaller.remove).mockResolvedValue({ removed: false })

      const result = await localModelHandlers['local_model.remove']({ model: 'embedding' }, ctx)

      expect(localModelRegistry.removeArtifact).not.toHaveBeenCalled()
      expect(result).toEqual({ removed: false })
    })
  })
})
