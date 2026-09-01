import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { FileInfoSchema } from '@shared/types/file'

const { recognizeMock, isLocalModelReadyMock, ocrModelPathsMock } = vi.hoisted(() => ({
  recognizeMock: vi.fn(),
  isLocalModelReadyMock: vi.fn(),
  ocrModelPathsMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'OcrInferenceService') return { recognize: recognizeMock }
    return originalGet(name)
  })
  return result
})

vi.mock('@main/ai/inference/ocrModelPaths', () => ({
  ocrModelPaths: ocrModelPathsMock
}))

vi.mock('@main/services/localModel', () => ({
  isLocalModelReady: isLocalModelReadyMock
}))

import { localPaddleocrImageToTextHandler } from '../imageToText/handler'

const MODEL_PATHS = {
  detection: '/models/paddleocr/PP-OCRv6_medium_det.onnx',
  recognition: '/models/paddleocr/PP-OCRv6_medium_rec.onnx',
  charactersDictionary: '/models/paddleocr/ppocrv6_dict.txt'
}

const imageFile = FileInfoSchema.parse({
  path: '/tmp/input.png',
  name: 'input',
  size: 1024,
  ext: 'png',
  mime: 'image/png',
  type: 'image',
  createdAt: 1,
  modifiedAt: 1
})

const documentFile = FileInfoSchema.parse({
  path: '/tmp/input.pdf',
  name: 'input',
  size: 1024,
  ext: 'pdf',
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1,
  modifiedAt: 1
})

const config = { id: 'local-paddleocr', type: 'builtin', capabilities: [] } as unknown as FileProcessorMerged

describe('localPaddleocrImageToTextHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isLocalModelReadyMock.mockReturnValue(true)
    ocrModelPathsMock.mockReturnValue(MODEL_PATHS)
  })

  it('recognizes text from an image off the main thread', async () => {
    const prepared = await localPaddleocrImageToTextHandler.prepare(imageFile, config)
    if (prepared.mode !== 'background') {
      throw new Error('Expected local PaddleOCR handler to prepare a background task')
    }

    recognizeMock.mockResolvedValueOnce({ text: 'hello world', lines: [] })
    const signal = new AbortController().signal

    await expect(prepared.execute({ signal, reportProgress: vi.fn() })).resolves.toEqual({
      kind: 'text',
      text: 'hello world'
    })
    expect(recognizeMock).toHaveBeenCalledWith(MODEL_PATHS, { kind: 'path', imagePath: '/tmp/input.png' }, signal)
  })

  it('rejects non-image files', () => {
    expect(() => localPaddleocrImageToTextHandler.prepare(documentFile, config)).toThrow(
      'Local PaddleOCR only supports image files'
    )
  })

  // Covers the onnxruntime binary too, not just the weights: probing the weight
  // files alone let a job through that then died in the inference worker with a
  // bare `Cannot find module ...onnxruntime_binding.node`.
  it('rejects when the local OCR model is not ready', () => {
    isLocalModelReadyMock.mockReturnValue(false)

    expect(() => localPaddleocrImageToTextHandler.prepare(imageFile, config)).toThrow(
      'Local PaddleOCR model is not downloaded'
    )
    expect(isLocalModelReadyMock).toHaveBeenCalledWith('ocr')
  })

  it('throws if the prepare signal is already aborted', () => {
    const controller = new AbortController()
    controller.abort()

    expect(() => localPaddleocrImageToTextHandler.prepare(imageFile, config, controller.signal)).toThrow()
  })
})
