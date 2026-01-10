import type { UnfilteredLoaderChunk } from '@cherrystudio/embedjs-interfaces'
import { BaseLoader } from '@cherrystudio/embedjs-interfaces'
import { cleanString } from '@cherrystudio/embedjs-utils'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { loggerService } from '@logger'
import { ocrService } from '@main/services/ocr/OcrService'
import type { ImageFileMetadata, OcrProvider } from '@types'

const logger = loggerService.withContext('ImageLoader')

/**
 * ImageLoader 的配置选项
 */
interface ImageLoaderOptions {
  file: ImageFileMetadata
  ocrProvider: OcrProvider
  chunkSize?: number
  chunkOverlap?: number
}

/**
 * ImageLoader 使用 OCR 提取图片中的文本内容
 */
export class ImageLoader extends BaseLoader<{ type: 'ImageLoader' }> {
  private readonly file: ImageFileMetadata
  private readonly ocrProvider: OcrProvider

  constructor({ file, ocrProvider, chunkSize, chunkOverlap }: ImageLoaderOptions) {
    super(
      `ImageLoader_${file.path}`,
      { type: 'ImageLoader', filePath: file.path },
      chunkSize ?? 2000,
      chunkOverlap ?? 0
    )
    this.file = file
    this.ocrProvider = ocrProvider
  }

  override async *getUnfilteredChunks(): AsyncGenerator<UnfilteredLoaderChunk<{ type: 'ImageLoader' }>, void, void> {
    try {
      const ocrResult = await ocrService.ocr(this.file, this.ocrProvider)

      if (!ocrResult.text || ocrResult.text.trim().length === 0) {
        return
      }
      const chunker = new RecursiveCharacterTextSplitter({
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap
      })

      const chunks = await chunker.splitText(cleanString(ocrResult.text))

      for (const chunk of chunks) {
        yield {
          pageContent: chunk,
          metadata: {
            type: 'ImageLoader' as const,
            source: this.file.path
          }
        }
      }
    } catch (error) {
      logger.error(`[ImageLoader] Failed to process image with OCR: ${this.file.path}`, error as Error)
      throw error
    }
  }
}
