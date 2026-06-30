import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { type FileInfo, FileInfoSchema } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recognizeMock, isLocalPaddleocrModelDownloadedMock, ocrModelPathsMock } = vi.hoisted(() => ({
  recognizeMock: vi.fn(),
  isLocalPaddleocrModelDownloadedMock: vi.fn(),
  ocrModelPathsMock: vi.fn()
}))

vi.mock('@main/ai/inference/InferenceHost', () => ({
  inferenceHost: { recognize: recognizeMock }
}))

vi.mock('../modelPaths', () => ({
  isLocalPaddleocrModelDownloaded: isLocalPaddleocrModelDownloadedMock,
  ocrModelPaths: ocrModelPathsMock
}))

import { localPaddleocrImageToTextHandler } from '../image-to-text/handler'

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
}) as FileInfo

const documentFile = FileInfoSchema.parse({
  path: '/tmp/input.pdf',
  name: 'input',
  size: 1024,
  ext: 'pdf',
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1,
  modifiedAt: 1
}) as FileInfo

const config = { id: 'local-paddleocr', type: 'builtin', capabilities: [] } as unknown as FileProcessorMerged

describe('localPaddleocrImageToTextHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isLocalPaddleocrModelDownloadedMock.mockReturnValue(true)
    ocrModelPathsMock.mockReturnValue(MODEL_PATHS)
  })

  it('recognizes text from an image off the main thread', async () => {
    const prepared = await localPaddleocrImageToTextHandler.prepare(imageFile, config)
    if (prepared.mode !== 'background') {
      throw new Error('Expected local PaddleOCR handler to prepare a background task')
    }

    recognizeMock.mockResolvedValueOnce('hello world')
    const signal = new AbortController().signal

    await expect(prepared.execute({ signal, reportProgress: vi.fn() })).resolves.toEqual({
      kind: 'text',
      text: 'hello world'
    })
    expect(recognizeMock).toHaveBeenCalledWith(MODEL_PATHS, '/tmp/input.png', signal)
  })

  it('rejects non-image files', () => {
    expect(() => localPaddleocrImageToTextHandler.prepare(documentFile, config)).toThrow(
      'Local PaddleOCR only supports image files'
    )
  })

  it('rejects when the model has not been downloaded', () => {
    isLocalPaddleocrModelDownloadedMock.mockReturnValue(false)

    expect(() => localPaddleocrImageToTextHandler.prepare(imageFile, config)).toThrow(
      'Local PaddleOCR model is not downloaded'
    )
  })

  it('throws if the prepare signal is already aborted', () => {
    const controller = new AbortController()
    controller.abort()

    expect(() => localPaddleocrImageToTextHandler.prepare(imageFile, config, controller.signal)).toThrow()
  })
})
