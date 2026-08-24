import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(() => ({})),
  getPath: vi.fn(() => '/tmp/cherry-ocr-test.png'),
  resolveProcessor: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: mocks.get, getPath: mocks.getPath }
}))

vi.mock('node:fs/promises', () => ({
  rm: mocks.rm,
  writeFile: mocks.writeFile
}))

vi.mock('../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: mocks.resolveProcessor
}))

const { ocrImageBytes } = await import('../ocrImageToText')

describe('ocrImageBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rm.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.resolveProcessor.mockImplementation(() => {
      throw new Error('OCR failed')
    })
  })

  it('creates the transient screenshot owner-only and removes it after OCR fails', async () => {
    const signal = new AbortController().signal

    await expect(ocrImageBytes(new Uint8Array([1, 2, 3]), signal)).rejects.toThrow('OCR failed')

    expect(mocks.writeFile).toHaveBeenCalledWith('/tmp/cherry-ocr-test.png', new Uint8Array([1, 2, 3]), {
      signal,
      mode: 0o600
    })
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/cherry-ocr-test.png', { force: true })
  })

  it('attempts cleanup when writing the transient screenshot fails', async () => {
    mocks.writeFile.mockRejectedValue(new Error('partial write'))

    await expect(ocrImageBytes(new Uint8Array([1]))).rejects.toThrow('partial write')

    expect(mocks.rm).toHaveBeenCalledWith('/tmp/cherry-ocr-test.png', { force: true })
    expect(mocks.resolveProcessor).not.toHaveBeenCalled()
  })
})
