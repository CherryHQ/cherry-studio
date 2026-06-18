import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  convertToBase64: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@renderer/databases', () => ({
  default: {
    settings: {
      add: mocks.add,
      delete: mocks.delete,
      get: mocks.get,
      update: mocks.update
    }
  }
}))

vi.mock('@renderer/utils', () => ({
  convertToBase64: mocks.convertToBase64
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError
    })
  }
}))

describe('ImageStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue(undefined)
    mocks.add.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue(undefined)
    mocks.delete.mockResolvedValue(undefined)
    mocks.convertToBase64.mockResolvedValue('data:image/png;base64,file')
  })

  it('awaits replacement writes for existing image keys', async () => {
    const { default: ImageStorage } = await import('../ImageStorage')
    let updateFinished = false
    mocks.get.mockResolvedValue({ id: 'image://provider-custom', value: 'old-logo' })
    mocks.update.mockImplementation(async () => {
      await Promise.resolve()
      updateFinished = true
    })

    await ImageStorage.set('provider-custom', 'new-logo')

    expect(mocks.update).toHaveBeenCalledWith('image://provider-custom', { value: 'new-logo' })
    expect(updateFinished).toBe(true)
  })

  it('throws storage write failures after logging them', async () => {
    const { default: ImageStorage } = await import('../ImageStorage')
    const error = new Error('disk full')
    mocks.add.mockRejectedValue(error)

    await expect(ImageStorage.set('provider-custom', 'new-logo')).rejects.toThrow('disk full')
    expect(mocks.loggerError).toHaveBeenCalledWith('Error storing the image', error)
  })
})
