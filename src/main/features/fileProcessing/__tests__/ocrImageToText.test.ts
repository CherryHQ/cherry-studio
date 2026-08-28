import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertFileTypeSupported: vi.fn(),
  execute: vi.fn(),
  getCapabilityHandler: vi.fn(),
  prepare: vi.fn(),
  resolveFileInfo: vi.fn(),
  resolveProcessor: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('node:fs/promises', () => ({
  rm: mocks.rm,
  writeFile: mocks.writeFile
}))

vi.mock('../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: mocks.resolveProcessor
}))

vi.mock('../tasks/jobExecution', () => ({
  assertFileTypeSupported: mocks.assertFileTypeSupported,
  getCapabilityHandler: mocks.getCapabilityHandler,
  resolveFileProcessingFileInfo: mocks.resolveFileInfo
}))

const { ocrImageBytes } = await import('../ocrImageToText')

describe('ocrImageBytes', () => {
  const transientPath = () => mocks.writeFile.mock.calls[0]?.[0]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rm.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.resolveFileInfo.mockResolvedValue({ path: '/tmp/cherry-ocr-test.png', ext: '.png', type: 'image', size: 3 })
    mocks.getCapabilityHandler.mockReturnValue({ prepare: mocks.prepare })
    mocks.prepare.mockResolvedValue({ mode: 'background', execute: mocks.execute })
    mocks.execute.mockResolvedValue({ kind: 'text', text: 'recognized text' })
    mocks.resolveProcessor.mockImplementation(() => {
      throw new Error('OCR failed')
    })
  })

  it('creates the transient screenshot owner-only and removes it after OCR fails', async () => {
    const signal = new AbortController().signal

    await expect(ocrImageBytes(new Uint8Array([1, 2, 3]), signal)).rejects.toThrow('OCR failed')

    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/cherry-ocr-.+\.png$/),
      new Uint8Array([1, 2, 3]),
      {
        signal,
        mode: 0o600
      }
    )
    expect(mocks.rm).toHaveBeenCalledWith(transientPath(), { force: true })
  })

  it('attempts cleanup when writing the transient screenshot fails', async () => {
    mocks.writeFile.mockRejectedValue(new Error('partial write'))

    await expect(ocrImageBytes(new Uint8Array([1]))).rejects.toThrow('partial write')

    expect(mocks.rm).toHaveBeenCalledWith(transientPath(), { force: true })
    expect(mocks.resolveProcessor).not.toHaveBeenCalled()
  })

  it('resolves and executes the configured processor for transient image bytes', async () => {
    const config = { id: 'system', capabilities: [{ feature: 'image_to_text', inputs: ['image'] }] }
    mocks.resolveProcessor.mockReturnValue(config)

    await expect(ocrImageBytes(new Uint8Array([4, 5, 6]))).resolves.toBe('recognized text')

    expect(mocks.resolveProcessor).toHaveBeenCalledWith('image_to_text')
    expect(mocks.getCapabilityHandler).toHaveBeenCalledWith('system', 'image_to_text')
    expect(mocks.resolveFileInfo).toHaveBeenCalledWith({ kind: 'path', path: transientPath() })
    expect(mocks.assertFileTypeSupported).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/cherry-ocr-test.png', type: 'image' }),
      'image_to_text',
      config
    )
    expect(mocks.prepare).toHaveBeenCalledWith(expect.any(Object), config, undefined)
    expect(mocks.execute).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      reportProgress: expect.any(Function)
    })
    expect(mocks.rm).toHaveBeenCalledWith(transientPath(), { force: true })
  })
})
