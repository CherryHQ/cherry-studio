import { readFile } from 'node:fs/promises'

import { application } from '@application'
import type { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc'
import { loggerService } from '@logger'
import { createPdfParser } from '@main/utils/pdf'

import type { FileProcessingCapabilityHandler } from '../../types'
import { ocrPdfPagesToMarkdown } from '../pdfPageOcr'

const logger = loggerService.withContext('LocalDocumentToMarkdownHandler')

/**
 * Rendering and recognizing a page costs a second or two, and the background
 * file-processing job is capped at 15 minutes with no retry. Refusing an
 * oversized document up front beats spending most of that budget and then
 * timing out with nothing to show for it.
 */
const MAX_PDF_PAGES = 300

/**
 * anydoc reports "this PDF is a scan, OCR it" only through the rejection message.
 * Its Rust side does tag the error with a `ConvertError` variant, but that tag does
 * not survive the napi boundary in 0.1.3 — every rejection arrives as
 * `code: 'GenericFailure'` — so the message is the sole signal. Sibling failures
 * read "malformed document: ..." / "unsupported input: unrecognized file content",
 * neither of which matches. `handler.smoke.test.ts` pins these strings against the
 * real binding, so an anydoc upgrade that rewords them fails loudly here.
 */
const SCANNED_PDF_MESSAGE = /no extractable text|OCR is required/

type AnydocModule = {
  formatFromExtension: typeof formatFromExtension
  toMarkdownBytes: typeof toMarkdownBytes
}

let anydocModulePromise: Promise<AnydocModule> | undefined

function loadAnydocModule(): Promise<AnydocModule> {
  return (anydocModulePromise ??= import('@firecrawl/anydoc'))
}

/**
 * Fully offline PDF to markdown. anydoc handles PDFs whose every page carries a
 * text layer; a scan or mixed PDF goes through local PaddleOCR in full so no page
 * can disappear from the result. `prepare` refuses the whole job unless that
 * model is ready, even for a text-layer PDF that would never touch it — a scan
 * must not reach a dead end halfway through.
 */
export const localDocumentToMarkdownHandler: FileProcessingCapabilityHandler<'document_to_markdown'> = {
  mode: 'background',
  async prepare(file, _config, signal) {
    signal?.throwIfAborted()

    if (file.ext?.toLowerCase() !== 'pdf') {
      throw new Error(`Local document processing only supports PDF files, got ${file.ext ?? 'no extension'}`)
    }
    if (!application.get('LocalModelService').isCapabilityReady('ocr')) {
      throw new Error('Local OCR model is not downloaded')
    }

    const pdfBytes = await readFile(file.path)
    signal?.throwIfAborted()

    const { pageCount, hasTextlessPages } = await inspectPdf(pdfBytes)
    if (pageCount > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${pageCount} pages, which exceeds the ${MAX_PDF_PAGES}-page local processing limit`)
    }

    return {
      mode: 'background',
      async execute(executionContext) {
        if (!hasTextlessPages) {
          const anydocMarkdown = await convertWithAnydoc(pdfBytes)

          if (anydocMarkdown !== null) {
            executionContext.reportProgress(100)
            return { kind: 'markdown', markdownContent: anydocMarkdown }
          }
        }

        logger.info('PDF requires OCR fallback; using local OCR for the complete document', {
          pageCount
        })
        return {
          kind: 'markdown',
          markdownContent: await ocrPdfPagesToMarkdown(pdfBytes, pageCount, executionContext)
        }
      }
    }
  }
}

/** Markdown from the PDF's text layer, or `null` when it has none and OCR must take over. */
async function convertWithAnydoc(pdfBytes: Uint8Array): Promise<string | null> {
  const anydoc = await loadAnydocModule()

  try {
    return (await anydoc.toMarkdownBytes(pdfBytes, anydoc.formatFromExtension('pdf') ?? undefined)).trim()
  } catch (error) {
    if (isScannedPdfError(error)) {
      return null
    }
    // Encrypted and malformed PDFs are equally unreadable to the rasterizer, so
    // there is nothing to gain from spending minutes on OCR before failing.
    throw error
  }
}

/** Whether an anydoc rejection means "no text layer, hand this to OCR". */
export function isScannedPdfError(error: unknown): boolean {
  return error instanceof Error && SCANNED_PDF_MESSAGE.test(error.message)
}

async function inspectPdf(pdfBytes: Uint8Array): Promise<{ pageCount: number; hasTextlessPages: boolean }> {
  const parser = await createPdfParser({ data: pdfBytes })
  try {
    const result = await parser.getText()
    return {
      pageCount: result.total,
      hasTextlessPages: result.pages.some((page) => page.text.trim().length === 0)
    }
  } finally {
    await parser.destroy()
  }
}
