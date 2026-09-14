import { beforeEach, describe, expect, it, vi } from 'vitest'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const isInChina = vi.hoisted(() => vi.fn())

const localModelService = vi.hoisted(() => ({
  listModels: vi.fn(),
  refreshStatus: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  isHardwareAccelerationSupported: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'LocalModelService') return localModelService
    return originalGet(name)
  })
  return result
})
vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina } }))

const { localModelHandlers } = await import('../localModel')
const ctx = { senderId: 'w1' }

describe('localModelHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isInChina.mockResolvedValue(false)
    localModelService.listModels.mockReturnValue([
      { id: EMBEDDING, capability: 'embedding' },
      { id: OCR, capability: 'ocr' }
    ])
    localModelService.isHardwareAccelerationSupported.mockReturnValue(true)
  })

  it('delegates lifecycle routes to the local model service', async () => {
    localModelService.refreshStatus.mockReturnValue({ status: 'ready' })
    localModelService.download.mockResolvedValue('ready')
    localModelService.remove.mockResolvedValue({ removed: false })

    await expect(localModelHandlers['local_model.get_status']({ id: EMBEDDING }, ctx)).resolves.toEqual({
      status: 'ready'
    })
    await expect(localModelHandlers['local_model.download']({ id: OCR }, ctx)).resolves.toEqual({ result: 'ready' })
    await localModelHandlers['local_model.cancel']({ id: EMBEDDING }, ctx)
    await expect(localModelHandlers['local_model.remove']({ id: OCR }, ctx)).resolves.toEqual({ removed: false })

    expect(localModelService.refreshStatus).toHaveBeenCalledWith(EMBEDDING)
    expect(localModelService.download).toHaveBeenCalledWith(OCR, expect.any(Function))
    expect(localModelService.cancel).toHaveBeenCalledWith(EMBEDDING)
    expect(localModelService.remove).toHaveBeenCalledWith(OCR)
  })

  it.each([
    [true, 'china-first'],
    [false, 'global-first']
  ] as const)('lazily maps egress-in-China=%s to %s', async (inChina, preference) => {
    isInChina.mockResolvedValue(inChina)
    localModelService.download.mockResolvedValue('ready')

    await localModelHandlers['local_model.download']({ id: OCR }, ctx)

    expect(isInChina).not.toHaveBeenCalled()
    const resolvePreference = localModelService.download.mock.calls[0][1]
    await expect(resolvePreference()).resolves.toBe(preference)
    expect(isInChina).toHaveBeenCalledOnce()
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
