import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isMac: true, isWin: false }))
vi.mock('@main/core/platform', () => platform)

const native = vi.hoisted(() => ({ recognize: vi.fn(), OcrAccuracy: { Accurate: 1 } }))
vi.mock('@napi-rs/system-ocr', () => native)

const localModel = vi.hoisted(() => ({ isCapabilityReady: vi.fn() }))
const inference = vi.hoisted(() => ({ recognize: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  mock.application.get.mockImplementation((name) => {
    if (name === 'LocalModelService') return localModel
    if (name === 'OcrInferenceService') return inference
    return mock.application.getContainer().get(name)
  })
  return mock
})

import { isScreenshotOcrAvailable, recognizeScreenshotText } from '../recognizeText'

const image = new Uint8Array([137, 80, 78, 71])
const size = { width: 800, height: 400 }
const paddleResult = {
  text: 'good morning',
  lines: [
    [],
    [
      { text: 'good', confidence: 0.9, box: { x: 100, y: 50, width: 40, height: 18 } },
      { text: 'morning', confidence: 0.9, box: { x: 150, y: 48, width: 60, height: 27 } }
    ]
  ]
}

describe('screenshot OCR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.recognize.mockReset()
    platform.isMac = true
    platform.isWin = false
    localModel.isCapabilityReady.mockReturnValue(false)
    inference.recognize.mockResolvedValue(paddleResult)
  })

  it.each(['macOS', 'Windows'])('uses native line bounds on %s without a local model', async (os) => {
    platform.isMac = os === 'macOS'
    platform.isWin = os === 'Windows'
    native.recognize.mockResolvedValue({
      text: 'formatted document',
      confidence: 1,
      lines: [{ text: 'native line', confidence: 1, boundingBox: { x: 0.125, y: 0.25, width: 0.5, height: 0.125 } }]
    })

    expect(isScreenshotOcrAvailable()).toBe(true)
    expect(await recognizeScreenshotText(image, size)).toEqual({
      status: 'ok',
      lines: [{ text: 'native line', box: { x: 100, y: 100, width: 400, height: 50 } }]
    })
    expect(inference.recognize).not.toHaveBeenCalled()
  })

  it('retains Paddle glyph bounds and reading order on Linux', async () => {
    platform.isMac = false
    localModel.isCapabilityReady.mockReturnValue(true)

    expect(isScreenshotOcrAvailable()).toBe(true)
    expect(await recognizeScreenshotText(image, size)).toEqual({
      status: 'ok',
      lines: [{ text: 'good morning', box: { x: 106, y: 54, width: 95, height: 15 } }]
    })
    expect(native.recognize).not.toHaveBeenCalled()
  })

  it('reports unavailable on Linux when the local model is missing', async () => {
    platform.isMac = false

    expect(isScreenshotOcrAvailable()).toBe(false)
    expect(await recognizeScreenshotText(image, size)).toEqual({ status: 'unavailable' })
    expect(native.recognize).not.toHaveBeenCalled()
    expect(inference.recognize).not.toHaveBeenCalled()
  })

  it('uses the installed Paddle model if the native binding fails', async () => {
    native.recognize.mockRejectedValue(new Error('Cannot find native binding'))
    localModel.isCapabilityReady.mockReturnValue(true)

    expect(await recognizeScreenshotText(image, size)).toEqual({
      status: 'ok',
      lines: [{ text: 'good morning', box: { x: 106, y: 54, width: 95, height: 15 } }]
    })
  })

  it('surfaces native failure when no fallback model is installed', async () => {
    native.recognize.mockRejectedValue(new Error('Cannot find native binding'))

    await expect(recognizeScreenshotText(image, size)).rejects.toThrow('Cannot find native binding')
    expect(inference.recognize).not.toHaveBeenCalled()
  })

  it('keeps an empty native recognition as success without falling back', async () => {
    native.recognize.mockResolvedValue({ text: '', confidence: 1, lines: [] })
    localModel.isCapabilityReady.mockReturnValue(true)

    expect(await recognizeScreenshotText(image, size)).toEqual({ status: 'ok', lines: [] })
    expect(inference.recognize).not.toHaveBeenCalled()
  })
})
