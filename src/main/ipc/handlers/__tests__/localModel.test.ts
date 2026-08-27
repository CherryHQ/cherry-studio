import { beforeEach, describe, expect, it, vi } from 'vitest'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const localModelService = vi.hoisted(() => ({
  listModels: vi.fn(),
  getStatusInfo: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  isHardwareAccelerationSupported: vi.fn()
}))

vi.mock('@main/ai/localModel', () => ({ localModelService }))

const { localModelHandlers } = await import('../localModel')
const ctx = { senderId: 'w1' }

describe('localModelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localModelService.listModels.mockReturnValue([
      { id: EMBEDDING, capability: 'embedding' },
      { id: OCR, capability: 'ocr' }
    ])
    localModelService.isHardwareAccelerationSupported.mockReturnValue(true)
  })

  it('delegates lifecycle routes to the local model service', async () => {
    localModelService.getStatusInfo.mockReturnValue({ status: 'ready' })
    localModelService.download.mockResolvedValue('ready')
    localModelService.remove.mockResolvedValue({ removed: false })

    await expect(localModelHandlers['local_model.get_status']({ id: EMBEDDING }, ctx)).resolves.toEqual({
      status: 'ready'
    })
    await expect(localModelHandlers['local_model.download']({ id: OCR }, ctx)).resolves.toEqual({ result: 'ready' })
    await localModelHandlers['local_model.cancel']({ id: EMBEDDING }, ctx)
    await expect(localModelHandlers['local_model.remove']({ id: OCR }, ctx)).resolves.toEqual({ removed: false })

    expect(localModelService.getStatusInfo).toHaveBeenCalledWith(EMBEDDING)
    expect(localModelService.download).toHaveBeenCalledWith(OCR)
    expect(localModelService.cancel).toHaveBeenCalledWith(EMBEDDING)
    expect(localModelService.remove).toHaveBeenCalledWith(OCR)
  })

  it('returns the service catalog and hardware capability unchanged', async () => {
    await expect(localModelHandlers['local_model.list'](undefined, ctx)).resolves.toEqual({
      models: [
        { id: EMBEDDING, capability: 'embedding' },
        { id: OCR, capability: 'ocr' }
      ]
    })
    await expect(localModelHandlers['local_model.get_acceleration_capability'](undefined, ctx)).resolves.toEqual({
      supported: true
    })
  })
})
