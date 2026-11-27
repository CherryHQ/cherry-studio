import { beforeEach, describe, expect, it, vi } from 'vitest'

const OCR = 'pp-ocrv6-medium'
const isInChina = vi.hoisted(() => vi.fn())
const localModelService = vi.hoisted(() => ({ download: vi.fn() }))

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
  })

  it.each([
    [true, 'china-first'],
    [false, 'global-first']
  ] as const)('lazily maps egress-in-China=%s to %s', async (inChina, preference) => {
    isInChina.mockResolvedValue(inChina)
    localModelService.download.mockResolvedValue('ready')

    await expect(localModelHandlers['local_model.download']({ id: OCR }, ctx)).resolves.toEqual({ result: 'ready' })
    expect(localModelService.download).toHaveBeenCalledWith(OCR, expect.any(Function))

    expect(isInChina).not.toHaveBeenCalled()
    const resolvePreference = localModelService.download.mock.calls[0][1]
    await expect(resolvePreference()).resolves.toBe(preference)
    expect(isInChina).toHaveBeenCalledOnce()
  })
})
