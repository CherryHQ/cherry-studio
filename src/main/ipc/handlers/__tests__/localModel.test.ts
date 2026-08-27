import type * as InstallersModule from '@main/ai/localModel/registry/installers'
import type * as AccelerationModule from '@main/ai/localModel/runtime/inferenceAcceleration'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const { isLocalInferenceHardwareAccelerationSupported, gcSharedArtifacts, embedding, ocr } = vi.hoisted(() => ({
  isLocalInferenceHardwareAccelerationSupported: vi.fn(() => true),
  gcSharedArtifacts: vi.fn(),
  embedding: { getStatusInfo: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn() },
  ocr: { getStatusInfo: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn() }
}))

vi.mock('@main/ai/localModel/runtime/inferenceAcceleration', async (importOriginal) => ({
  ...(await importOriginal<typeof AccelerationModule>()),
  isLocalInferenceHardwareAccelerationSupported
}))

// The catalog stays real (that is what `list` reports); the per-bundle managers and the
// shared-artifact GC are stubbed — the GC rule itself is tested in installers.test.ts.
vi.mock('@main/ai/localModel/registry/installers', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallersModule>()),
  installerFor: (id: string) => (id === EMBEDDING ? embedding : ocr),
  gcSharedArtifacts
}))

const { localModelHandlers } = await import('../localModel')

const ctx = { senderId: 'w1' }

describe('localModelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gcSharedArtifacts.mockResolvedValue(undefined)
  })

  it('dispatches get_status/download/cancel to the addressed bundle', async () => {
    embedding.getStatusInfo.mockReturnValue({ status: 'ready' })
    ocr.download.mockResolvedValue('ready')

    const status = await localModelHandlers['local_model.get_status']({ id: EMBEDDING }, ctx)
    const result = await localModelHandlers['local_model.download']({ id: OCR }, ctx)
    await localModelHandlers['local_model.cancel']({ id: EMBEDDING }, ctx)

    expect(status).toEqual({ status: 'ready' })
    expect(result).toEqual({ result: 'ready' })
    expect(ocr.download).toHaveBeenCalled()
    expect(embedding.cancel).toHaveBeenCalled()
  })

  it('lists every installable bundle with the capability its card renders from', async () => {
    const { models } = await localModelHandlers['local_model.list'](undefined, ctx)

    expect(models).toEqual(
      expect.arrayContaining([
        { id: EMBEDDING, capability: 'embedding' },
        { id: OCR, capability: 'ocr' }
      ])
    )
  })

  it('reports the main-process hardware acceleration capability', async () => {
    await expect(localModelHandlers['local_model.get_acceleration_capability'](undefined, ctx)).resolves.toEqual({
      supported: true
    })

    expect(isLocalInferenceHardwareAccelerationSupported).toHaveBeenCalledOnce()
  })

  describe('download', () => {
    it('leaves the shared runtimes alone when the download succeeds', async () => {
      embedding.download.mockResolvedValue('ready')

      await expect(localModelHandlers['local_model.download']({ id: EMBEDDING }, ctx)).resolves.toEqual({
        result: 'ready'
      })

      expect(gcSharedArtifacts).not.toHaveBeenCalled()
    })

    it('collects unused shared runtimes after a cancelled download', async () => {
      // A cancelled download may have installed a runtime nothing now uses; left behind,
      // it reads as ready to the next status query.
      embedding.download.mockResolvedValue('cancelled')

      await expect(localModelHandlers['local_model.download']({ id: EMBEDDING }, ctx)).resolves.toEqual({
        result: 'cancelled'
      })

      expect(gcSharedArtifacts).toHaveBeenCalledOnce()
    })

    it('collects unused shared runtimes after a failed download, and still reports the failure', async () => {
      const downloadError = new Error('network down')
      ocr.download.mockRejectedValue(downloadError)

      await expect(localModelHandlers['local_model.download']({ id: OCR }, ctx)).rejects.toBe(downloadError)

      expect(gcSharedArtifacts).toHaveBeenCalledOnce()
    })
  })

  it('collects unused shared runtimes after a removal, and reports what the manager decided', async () => {
    embedding.remove.mockResolvedValue({ removed: false })

    const result = await localModelHandlers['local_model.remove']({ id: EMBEDDING }, ctx)

    expect(result).toEqual({ removed: false })
    expect(gcSharedArtifacts).toHaveBeenCalledOnce()
  })
})
