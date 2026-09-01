import type * as FsPromises from 'node:fs/promises'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as MainFileUtils from '@main/utils/file'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { FileInfoSchema } from '@shared/types/file'

const {
  tempRoot,
  recognizeMock,
  isLocalModelReadyMock,
  ocrModelPathsMock,
  toMarkdownBytesMock,
  formatFromExtensionMock,
  getTextMock,
  getScreenshotMock,
  destroyMock,
  readFileMock,
  ensureDirMock,
  removeDirMock,
  removeMock,
  writeMock,
  preprocessImageMock
} = vi.hoisted(() => ({
  // The shared application mock hands back a POSIX `/mock/...` root, which `path.join`
  // turns into a drive-less `\mock\...` on Windows — and `AbsoluteFilePathSchema` rejects
  // that. Override the one path the handler uses so it stays absolute on both platforms.
  tempRoot: process.platform === 'win32' ? 'C:\\mock\\file-processing-temp' : '/mock/file-processing-temp',
  recognizeMock: vi.fn(),
  isLocalModelReadyMock: vi.fn(),
  ocrModelPathsMock: vi.fn(),
  toMarkdownBytesMock: vi.fn(),
  formatFromExtensionMock: vi.fn(),
  getTextMock: vi.fn(),
  getScreenshotMock: vi.fn(),
  destroyMock: vi.fn(),
  readFileMock: vi.fn(),
  ensureDirMock: vi.fn(),
  removeDirMock: vi.fn(),
  removeMock: vi.fn(),
  writeMock: vi.fn(),
  preprocessImageMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'OcrInferenceService') return { recognize: recognizeMock }
    return originalGet(name)
  })
  const originalGetPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((key: string, filename?: string) =>
    key === 'feature.file_processing.temp' ? tempRoot : originalGetPath(key, filename)
  )
  return result
})

vi.mock('@main/ai/inference/ocrModelPaths', () => ({
  ocrModelPaths: ocrModelPathsMock
}))

vi.mock('@main/services/localModel', () => ({
  isLocalModelReady: isLocalModelReadyMock
}))

vi.mock('@firecrawl/anydoc', () => ({
  toMarkdownBytes: toMarkdownBytesMock,
  formatFromExtension: formatFromExtensionMock
}))

vi.mock('@main/utils/pdf', () => ({
  createPdfParser: vi.fn(async () => ({
    getText: getTextMock,
    getScreenshot: getScreenshotMock,
    destroy: destroyMock
  }))
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  readFile: readFileMock
}))

vi.mock('@main/utils/file', async (importOriginal) => ({
  ...(await importOriginal<typeof MainFileUtils>()),
  ensureDir: ensureDirMock,
  remove: removeMock,
  removeDir: removeDirMock,
  write: writeMock
}))

vi.mock('../../../utils/ocr', () => ({ preprocessImage: preprocessImageMock }))

import { localDocumentToMarkdownHandler } from '../documentToMarkdown/handler'

const MODEL_PATHS = {
  detection: '/models/paddleocr/PP-OCRv6_medium_det.onnx',
  recognition: '/models/paddleocr/PP-OCRv6_medium_rec.onnx',
  charactersDictionary: '/models/paddleocr/ppocrv6_dict.txt'
}

const PDF_BYTES = Buffer.from('%PDF-1.7 fake')

const config = { id: 'local-document', type: 'builtin', capabilities: [] } as unknown as FileProcessorMerged

function createFile(ext: string | null, name = 'input') {
  return FileInfoSchema.parse({
    path: `/tmp/${name}${ext ? `.${ext}` : ''}`,
    name,
    size: 1024,
    ext,
    mime: 'application/pdf',
    type: 'document',
    createdAt: 1,
    modifiedAt: 1
  })
}

const pdfFile = createFile('pdf')

/**
 * anydoc rejections all arrive as `code: 'GenericFailure'` — the message is the only
 * thing that distinguishes them. These strings are the real ones; `handler.smoke.test.ts`
 * pins them against the actual binding.
 */
function anydocError(message: string): Error {
  return Object.assign(new Error(message), { code: 'GenericFailure' })
}

const SCANNED_PDF_ERROR = anydocError(
  'unsupported input: PDF has no extractable text (Scanned, 3 pages): OCR is required'
)

async function prepareBackground(file = pdfFile, signal?: AbortSignal) {
  const prepared = await localDocumentToMarkdownHandler.prepare(file, config, signal)
  if (prepared.mode !== 'background') {
    throw new Error('Expected local document handler to prepare a background task')
  }
  return prepared
}

describe('localDocumentToMarkdownHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isLocalModelReadyMock.mockReturnValue(true)
    ocrModelPathsMock.mockReturnValue(MODEL_PATHS)
    formatFromExtensionMock.mockReturnValue('pdf')
    readFileMock.mockResolvedValue(PDF_BYTES)
    getTextMock.mockResolvedValue({
      total: 3,
      pages: [
        { num: 1, text: 'one' },
        { num: 2, text: 'two' },
        { num: 3, text: 'three' }
      ]
    })
    preprocessImageMock.mockImplementation(async (buffer: Buffer) => buffer)
    ensureDirMock.mockResolvedValue(undefined)
    removeMock.mockResolvedValue(undefined)
    removeDirMock.mockResolvedValue(undefined)
    writeMock.mockResolvedValue(undefined)
    destroyMock.mockResolvedValue(undefined)
  })

  describe('prepare', () => {
    it('rejects a non-PDF document', async () => {
      await expect(prepareBackground(createFile('docx'))).rejects.toThrow(
        'Local document processing only supports PDF files, got docx'
      )
    })

    it('rejects a file with no extension', async () => {
      await expect(prepareBackground(createFile(null))).rejects.toThrow('got no extension')
    })

    it('rejects when the local OCR model has not been downloaded', async () => {
      isLocalModelReadyMock.mockReturnValue(false)

      await expect(prepareBackground()).rejects.toThrow('Local OCR model is not downloaded')
      expect(readFileMock).not.toHaveBeenCalled()
    })

    it('rejects a PDF past the page limit, naming the actual page count', async () => {
      getTextMock.mockResolvedValue({ total: 301, pages: [] })

      await expect(prepareBackground()).rejects.toThrow(
        'PDF has 301 pages, which exceeds the 300-page local processing limit'
      )
    })

    it('accepts a PDF exactly at the page limit', async () => {
      getTextMock.mockResolvedValue({ total: 300, pages: [] })

      await expect(prepareBackground()).resolves.toBeDefined()
    })

    it('throws if the prepare signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(prepareBackground(pdfFile, controller.signal)).rejects.toThrow()
    })
  })

  describe('execute', () => {
    it('returns the anydoc conversion for a PDF that carries a text layer, without touching OCR', async () => {
      const prepared = await prepareBackground()
      toMarkdownBytesMock.mockResolvedValueOnce('# Title\n\nbody\n')
      const reportProgress = vi.fn()

      await expect(prepared.execute({ signal: new AbortController().signal, reportProgress })).resolves.toEqual({
        kind: 'markdown',
        markdownContent: '# Title\n\nbody'
      })

      expect(toMarkdownBytesMock).toHaveBeenCalledWith(PDF_BYTES, 'pdf')
      expect(recognizeMock).not.toHaveBeenCalled()
      expect(getScreenshotMock).not.toHaveBeenCalled()
      expect(reportProgress).toHaveBeenLastCalledWith(100)
    })

    it('falls back to per-page OCR when anydoc reports no extractable text', async () => {
      getTextMock.mockResolvedValue({
        total: 3,
        pages: [
          { num: 1, text: '' },
          { num: 2, text: '' },
          { num: 3, text: '' }
        ]
      })
      const prepared = await prepareBackground()
      getScreenshotMock.mockImplementation(async ({ partial }: { partial: number[] }) => ({
        pages: [{ data: new Uint8Array([partial[0]]) }]
      }))
      recognizeMock
        .mockResolvedValueOnce({ text: ' page one \n', lines: [] })
        .mockResolvedValueOnce({ text: 'page two', lines: [] })
        .mockResolvedValueOnce({ text: 'page three', lines: [] })
      const reportProgress = vi.fn()

      await expect(prepared.execute({ signal: new AbortController().signal, reportProgress })).resolves.toEqual({
        kind: 'markdown',
        markdownContent: 'page one\n\npage two\n\npage three'
      })

      expect(getScreenshotMock).toHaveBeenCalledTimes(3)
      expect(getScreenshotMock).toHaveBeenNthCalledWith(1, {
        partial: [1],
        scale: 3,
        imageBuffer: true,
        imageDataUrl: false
      })
      expect(recognizeMock).toHaveBeenNthCalledWith(
        1,
        MODEL_PATHS,
        { kind: 'path', imagePath: expect.any(String) },
        expect.anything()
      )
      // Each job renders into its own directory under the file-processing temp root.
      const firstImagePath = recognizeMock.mock.calls[0][1].imagePath
      expect(path.dirname(path.dirname(firstImagePath))).toBe(tempRoot)
      expect(path.basename(path.dirname(firstImagePath))).toMatch(/^local-document-[\w-]+$/)
      expect(path.basename(firstImagePath)).toBe('page-1.png')
      expect(reportProgress.mock.calls.map(([value]) => value)).toEqual([33, 67, 100])
      expect(toMarkdownBytesMock).not.toHaveBeenCalled()
      expect(removeMock).toHaveBeenCalledTimes(3)
    })

    it('OCRs every page of a mixed PDF instead of accepting incomplete anydoc output', async () => {
      getTextMock.mockResolvedValue({
        total: 3,
        pages: [
          { num: 1, text: 'text page' },
          { num: 2, text: '' },
          { num: 3, text: 'another text page' }
        ]
      })
      const prepared = await prepareBackground()
      getScreenshotMock.mockImplementation(async ({ partial }: { partial: number[] }) => ({
        pages: [{ data: new Uint8Array([partial[0]]) }]
      }))
      recognizeMock
        .mockResolvedValueOnce({ text: 'page one', lines: [] })
        .mockResolvedValueOnce({ text: 'page two', lines: [] })
        .mockResolvedValueOnce({ text: 'page three', lines: [] })

      await expect(
        prepared.execute({ signal: new AbortController().signal, reportProgress: vi.fn() })
      ).resolves.toEqual({ kind: 'markdown', markdownContent: 'page one\n\npage two\n\npage three' })

      expect(toMarkdownBytesMock).not.toHaveBeenCalled()
      expect(getScreenshotMock).toHaveBeenCalledTimes(3)
    })

    it('skips a page the rasterizer could not render rather than failing the document', async () => {
      getTextMock.mockResolvedValue({
        total: 2,
        pages: [
          { num: 1, text: '' },
          { num: 2, text: '' }
        ]
      })
      const prepared = await prepareBackground()
      getScreenshotMock.mockResolvedValueOnce({ pages: [] }).mockResolvedValueOnce({
        pages: [{ data: new Uint8Array([2]) }]
      })
      recognizeMock.mockResolvedValueOnce({ text: 'only page two', lines: [] })

      await expect(
        prepared.execute({ signal: new AbortController().signal, reportProgress: vi.fn() })
      ).resolves.toEqual({ kind: 'markdown', markdownContent: 'only page two' })

      expect(recognizeMock).toHaveBeenCalledTimes(1)
      expect(removeMock).toHaveBeenCalledTimes(1)
    })

    it.each([
      'document is encrypted',
      'malformed document: invalid PDF structure',
      'unsupported input: unrecognized file content: name the format explicitly',
      'io error: permission denied',
      'resource limit exceeded (max_entry_bytes): 1'
    ])('rethrows "%s" instead of wasting minutes on OCR that cannot help', async (message) => {
      const prepared = await prepareBackground()
      toMarkdownBytesMock.mockRejectedValueOnce(anydocError(message))

      await expect(prepared.execute({ signal: new AbortController().signal, reportProgress: vi.fn() })).rejects.toThrow(
        message
      )
      expect(recognizeMock).not.toHaveBeenCalled()
    })

    it('stops on abort mid-OCR and still clears the temp directory', async () => {
      const prepared = await prepareBackground()
      toMarkdownBytesMock.mockRejectedValueOnce(SCANNED_PDF_ERROR)
      getScreenshotMock.mockResolvedValue({ pages: [{ data: new Uint8Array([1]) }] })
      const controller = new AbortController()
      recognizeMock.mockImplementationOnce(async () => {
        controller.abort()
        return { text: 'page one', lines: [] }
      })

      await expect(prepared.execute({ signal: controller.signal, reportProgress: vi.fn() })).rejects.toThrow()

      expect(recognizeMock).toHaveBeenCalledTimes(1)
      expect(removeDirMock).toHaveBeenCalledTimes(1)
      expect(removeMock).toHaveBeenCalledTimes(1)
      expect(destroyMock).toHaveBeenCalled()
    })

    it('clears the temp directory when OCR itself fails', async () => {
      const prepared = await prepareBackground()
      toMarkdownBytesMock.mockRejectedValueOnce(SCANNED_PDF_ERROR)
      getScreenshotMock.mockResolvedValue({ pages: [{ data: new Uint8Array([1]) }] })
      recognizeMock.mockRejectedValueOnce(new Error('inference worker died'))

      await expect(prepared.execute({ signal: new AbortController().signal, reportProgress: vi.fn() })).rejects.toThrow(
        'inference worker died'
      )

      expect(removeDirMock).toHaveBeenCalledTimes(1)
      expect(removeMock).toHaveBeenCalledTimes(1)
    })
  })
})
