import { pathToFileURL } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('extractPdfText module loading', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not load pdf-parse until extraction is requested', async () => {
    const pdfParseLoaded = vi.fn()

    vi.doMock('pdf-parse', () => {
      pdfParseLoaded()

      return {
        PDFParse: class PDFParse {}
      }
    })
    vi.doMock('pdf-parse/worker', () => ({
      CanvasFactory: class CanvasFactory {}
    }))

    await import('../pdf')

    expect(pdfParseLoaded).not.toHaveBeenCalled()
  })

  it('passes the Node CanvasFactory to PDFParse', async () => {
    const CanvasFactory = class CanvasFactory {}
    const data = new Uint8Array([37, 80, 68, 70])
    const destroyMock = vi.fn(async () => undefined)
    const getTextMock = vi.fn(async () => ({ text: 'Hello' }))
    const constructorMock = vi.fn()
    let workerLoaded = false
    let pdfParseLoadedAfterWorker = false

    vi.doMock('pdf-parse/worker', () => {
      workerLoaded = true

      return { CanvasFactory }
    })
    vi.doMock('pdf-parse', () => {
      pdfParseLoadedAfterWorker = workerLoaded

      return {
        PDFParse: class PDFParse {
          constructor(options: unknown) {
            constructorMock(options)
          }

          getText = getTextMock
          destroy = destroyMock
        }
      }
    })

    const { extractPdfText } = await import('../pdf')

    await expect(extractPdfText(data)).resolves.toBe('Hello')

    expect(pdfParseLoadedAfterWorker).toBe(true)
    expect(constructorMock).toHaveBeenCalledWith({ data, CanvasFactory })
    expect(getTextMock).toHaveBeenCalled()
    expect(destroyMock).toHaveBeenCalled()
  })

  it('reads local PDF metadata through a file URL and destroys the parser', async () => {
    const getInfoMock = vi.fn(async () => ({ total: 3 }))
    const destroyMock = vi.fn(async () => undefined)
    const constructorMock = vi.fn()

    vi.doMock('pdf-parse/worker', () => ({ CanvasFactory: class CanvasFactory {} }))
    vi.doMock('pdf-parse', () => ({
      PDFParse: class PDFParse {
        constructor(options: unknown) {
          constructorMock(options)
        }

        getInfo = getInfoMock
        destroy = destroyMock
      }
    }))

    const { getPdfPageCount } = await import('../pdf')
    const pdfPath = '/tmp/report with spaces.pdf'

    await expect(getPdfPageCount(pdfPath)).resolves.toBe(3)
    expect(constructorMock).toHaveBeenCalledWith(expect.objectContaining({ url: pathToFileURL(pdfPath).href }))
    expect(getInfoMock).toHaveBeenCalled()
    expect(destroyMock).toHaveBeenCalled()
  })

  it('destroys the parser when reading PDF metadata fails', async () => {
    const getInfoMock = vi.fn(async () => {
      throw new Error('invalid PDF')
    })
    const destroyMock = vi.fn(async () => undefined)

    vi.doMock('pdf-parse/worker', () => ({ CanvasFactory: class CanvasFactory {} }))
    vi.doMock('pdf-parse', () => ({
      PDFParse: class PDFParse {
        getInfo = getInfoMock
        destroy = destroyMock
      }
    }))

    const { getPdfPageCount } = await import('../pdf')

    await expect(getPdfPageCount('/tmp/invalid.pdf')).rejects.toThrow('invalid PDF')
    expect(destroyMock).toHaveBeenCalled()
  })

  it.each([
    ['extractable text', [{ num: 1, text: 'Hello' }], true],
    ['empty pages', [{ num: 1, text: '  ' }], false]
  ])('detects PDF text layers for %s', async (_case, pages, expected) => {
    const getTextMock = vi.fn(async () => ({ pages }))
    const destroyMock = vi.fn(async () => undefined)
    vi.doMock('pdf-parse/worker', () => ({ CanvasFactory: class CanvasFactory {} }))
    vi.doMock('pdf-parse', () => ({
      PDFParse: class PDFParse {
        getText = getTextMock
        destroy = destroyMock
      }
    }))
    const { hasPdfTextLayer } = await import('../pdf')

    await expect(hasPdfTextLayer(new Uint8Array([37, 80, 68, 70]))).resolves.toBe(expected)
    expect(getTextMock).toHaveBeenCalledWith({ pageJoiner: '' })
    expect(destroyMock).toHaveBeenCalled()
  })
})
