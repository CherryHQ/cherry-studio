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
})
