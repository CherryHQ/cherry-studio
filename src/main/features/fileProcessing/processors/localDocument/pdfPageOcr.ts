import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { application } from '@application'
import { ocrModelPaths } from '@main/ai/inference/ocrModelPaths'
import { ensureDir, removeDir, write } from '@main/utils/file'
import { createPdfParser } from '@main/utils/pdf'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { preprocessImage } from '../../utils/ocr'
import type { FileProcessingExecutionContext } from '../types'

/**
 * Render scale for the page rasters handed to OCR. PDF user space is 72dpi, so
 * 3x lands around 216dpi — enough for PP-OCRv6 to resolve body text without
 * making every page image enormous.
 */
const RENDER_SCALE = 3

/**
 * OCR every page of a scanned PDF and join the recognized text into markdown.
 *
 * `OcrInferenceService.recognize` only accepts an absolute path, so each page is
 * rendered, preprocessed, and written to a job-private temp directory before it
 * is recognized. Pages run one at a time: there is a single inference worker, so
 * concurrency would only queue up inside it while multiplying peak memory.
 *
 * The output carries no page markers. It feeds the same markdown artifact the
 * anydoc path produces, and that artifact gets chunked and embedded downstream —
 * synthetic `## Page N` headings or rules would put structure into the vectors
 * that the document never had.
 */
export async function ocrPdfPagesToMarkdown(
  pdfBytes: Uint8Array,
  pageCount: number,
  executionContext: FileProcessingExecutionContext
): Promise<string> {
  const workDir = AbsoluteFilePathSchema.parse(
    path.join(application.getPath('feature.file_processing.temp'), `local-document-${randomUUID()}`)
  )
  await ensureDir(workDir)

  try {
    const parser = await createPdfParser({ data: pdfBytes })

    try {
      const modelPaths = ocrModelPaths()
      const pages: string[] = []

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        executionContext.signal.throwIfAborted()

        const pageText = await recognizePage(parser, pageNumber, workDir, modelPaths, executionContext.signal)
        if (pageText.length > 0) {
          pages.push(pageText)
        }

        executionContext.reportProgress(Math.round((pageNumber / pageCount) * 100))
      }

      return pages.join('\n\n')
    } finally {
      await parser.destroy()
    }
  } finally {
    await removeDir(workDir)
  }
}

async function recognizePage(
  parser: Awaited<ReturnType<typeof createPdfParser>>,
  pageNumber: number,
  workDir: string,
  modelPaths: ReturnType<typeof ocrModelPaths>,
  signal: AbortSignal
): Promise<string> {
  const screenshot = await parser.getScreenshot({
    partial: [pageNumber],
    scale: RENDER_SCALE,
    imageBuffer: true,
    imageDataUrl: false
  })
  const rendered = screenshot.pages[0]?.data

  if (!rendered) {
    // pdf-parse skips pages it cannot rasterize; an unreadable page contributes
    // nothing rather than failing the whole document.
    return ''
  }

  const imagePath = AbsoluteFilePathSchema.parse(path.join(workDir, `page-${pageNumber}.png`))
  await write(imagePath, await preprocessImage(Buffer.from(rendered)))

  const text = await application.get('OcrInferenceService').recognize(modelPaths, imagePath, signal)
  return text.trim()
}
