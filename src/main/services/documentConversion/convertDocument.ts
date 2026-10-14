import { exportErrorCodes } from '@shared/ipc/errors/export'
import { DOCUMENT_MARKDOWN_MAX_BYTES, type DocumentFormat } from '@shared/types/documentConversion'

import { exportService } from '../ExportService'
import { printService } from '../PrintService'
import { DocumentConversionError } from './DocumentConversionError'
import { readImageAsset } from './imageAssets'
import { parseMarkdown } from './parseMarkdown'
import { convertPptx } from './pptx'
import { convertXlsx } from './xlsx'

export interface ConvertDocumentInput {
  markdown: string
  format: DocumentFormat
  title?: string
  sourcePath?: string
  assetRoot?: string
}

export async function convertDocument(input: ConvertDocumentInput, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  if (!input.markdown.trim())
    throw new DocumentConversionError(exportErrorCodes.EMPTY_DOCUMENT, 'Document is empty.', '')
  if (Buffer.byteLength(input.markdown) > DOCUMENT_MARKDOWN_MAX_BYTES) {
    throw new DocumentConversionError(
      exportErrorCodes.DOCUMENT_TOO_LARGE,
      'Document exceeds the 2 MB limit.',
      input.markdown.slice(0, 4000)
    )
  }
  try {
    if (input.format === 'docx') {
      const buffer = await exportService.toWordBuffer(input.markdown)
      signal?.throwIfAborted()
      return buffer
    }
    const blocks = parseMarkdown(input.markdown)
    const title = input.title || blocks.find((block) => block.type === 'heading')?.text || 'Document'
    if (input.format === 'xlsx') return await convertXlsx(blocks, signal)
    const images = new Map<string, Buffer>()
    let imageBytes = 0
    for (const block of blocks) {
      if (block.type === 'image' && !images.has(block.source)) {
        const image = await readImageAsset(block.source, input, signal)
        imageBytes += image.length
        if (imageBytes > 40 * 1024 * 1024)
          throw new DocumentConversionError(
            exportErrorCodes.INVALID_IMAGE,
            'Document images exceed the 40 MB limit.',
            block.source
          )
        images.set(block.source, image)
      }
    }
    if (input.format === 'pptx') return await convertPptx(blocks, images, title, signal)

    signal?.throwIfAborted()
    return await printService.toDocumentPdfBuffer(
      {
        title,
        markdown: input.markdown,
        images: Object.fromEntries(
          [...images].map(([source, data]) => [source, `data:image/png;base64,${data.toString('base64')}`])
        )
      },
      signal
    )
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof DocumentConversionError) throw error
    throw new DocumentConversionError(
      exportErrorCodes.CONVERSION_FAILED,
      error instanceof Error ? error.message : String(error),
      input.markdown.slice(0, 4000)
    )
  }
}
