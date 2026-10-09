import path from 'node:path'

import { exportErrorCodes } from '@shared/ipc/errors/export'
import type { DocumentFormat } from '@shared/types/documentConversion'

import { printService } from '../PrintService'
import { DocumentConversionError } from './DocumentConversionError'
import { convertDocx } from './docx'
import { renderStaticHtml } from './html'
import { normalizeDocumentImage, readImageAsset } from './imageAssets'
import { convertPptx } from './pptx'
import { readDocument, type DocumentSource } from './readDocument'
import { documentToHtml, documentToMarkdown, flattenDocumentBlocks } from './serializeDocument'
import { convertXlsx } from './xlsx'

export interface ConvertDocumentInput extends Omit<DocumentSource, 'relaxedTables'> {
  format: DocumentFormat
  title?: string
  outputName?: string
}

export interface ConvertedDocument {
  bytes: Buffer
  assets: Map<string, Buffer>
  warnings: string[]
  resourceDirectory?: string
}

export async function convertDocumentBundle(
  input: ConvertDocumentInput,
  signal?: AbortSignal
): Promise<ConvertedDocument> {
  signal?.throwIfAborted()
  try {
    const model = await readDocument({ ...input, relaxedTables: input.format === 'docx' }, signal)
    const blocks = flattenDocumentBlocks(model.blocks)
    if (!blocks.length) throw new DocumentConversionError(exportErrorCodes.EMPTY_DOCUMENT, 'Document is empty.', '')
    const title = input.title || blocks.find((block) => block.type === 'heading')?.text || 'Document'
    const images = new Map<string, Buffer>()
    let imageBytes = 0
    for (const block of blocks) {
      if (block.type !== 'image' || images.has(block.source)) continue
      const embedded = model.images.get(block.source)
      const image = embedded
        ? await normalizeDocumentImage(embedded, signal)
        : await readImageAsset(
            block.source,
            {
              sourcePath: input.filePath ?? input.sourcePath,
              assetRoot: input.assetRoot
            },
            signal
          )
      imageBytes += image.length
      if (imageBytes > 40 * 1024 * 1024) throw new Error('Document images exceed 40 MiB')
      images.set(block.source, image)
    }
    const assets = new Map<string, Buffer>()
    const result = (bytes: Buffer): ConvertedDocument => ({ bytes, assets, warnings: [...new Set(model.warnings)] })
    if (input.format === 'docx') return result(await convertDocx(model.blocks, images, title, signal))
    if (input.format === 'pptx') return result(await convertPptx(model.blocks, images, title, signal, model.warnings))
    if (input.format === 'xlsx') return result(await convertXlsx(blocks, signal))
    const embeddedSource = (source: string) => `data:image/png;base64,${images.get(source)!.toString('base64')}`
    if (input.format === 'html')
      return result(Buffer.from(model.html ?? documentToHtml(model.blocks, embeddedSource, title)))
    if (input.format === 'md') {
      const filename = input.outputName ?? 'document.md'
      const resourceDirectory = `${path.basename(filename, path.extname(filename))}.assets`
      const names = new Map<string, string>()
      for (const [source, bytes] of images) {
        const name = `image-${names.size + 1}.png`
        names.set(source, `${encodeURIComponent(resourceDirectory)}/${name}`)
        assets.set(name, bytes)
      }
      return {
        ...result(Buffer.from(documentToMarkdown(model.blocks, (source) => names.get(source)!))),
        ...(assets.size ? { resourceDirectory } : {})
      }
    }
    if (model.html) return result(await renderStaticHtml(model.html, true, signal))
    const markdown = model.markdown ?? documentToMarkdown(model.blocks, (source) => source)
    return result(
      await printService.toDocumentPdfBuffer(
        {
          title,
          markdown,
          images: Object.fromEntries([...images].map(([source]) => [source, embeddedSource(source)]))
        },
        signal
      )
    )
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof DocumentConversionError) throw error
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code))
        ? exportErrorCodes.SOURCE_UNREADABLE
        : exportErrorCodes.CONVERSION_FAILED
    throw new DocumentConversionError(
      code,
      error instanceof Error ? error.message : String(error),
      (input.markdown ?? input.filePath ?? '').slice(0, 4000)
    )
  }
}
