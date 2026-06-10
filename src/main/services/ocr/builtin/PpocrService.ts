import { PaddleOCRClient } from '@paddleocr/api-sdk'
import type { ImageFileMetadata, OcrPpocrConfig, OcrResult, SupportedOcrFile } from '@types'
import { isImageFileMetadata } from '@types'
import { net } from 'electron'

import { OcrBaseService } from './OcrBaseService'

/** PaddleOCR-based OCR service for image text extraction. */
export class PpocrService extends OcrBaseService {
  /** Runs OCR on an image file using the PaddleOCR API. */
  public ocr = async (file: SupportedOcrFile, options?: OcrPpocrConfig): Promise<OcrResult> => {
    if (!isImageFileMetadata(file)) {
      throw new Error('Only image files are supported currently')
    }
    if (!options?.apiUrl) {
      throw new Error('API URL is required')
    }
    return this.imageOcr(file, options)
  }

  /** Submits the image to PaddleOCR and extracts recognized text. */
  private async imageOcr(file: ImageFileMetadata, options: OcrPpocrConfig): Promise<OcrResult> {
    const client = new PaddleOCRClient({
      token: options.accessToken ?? '',
      baseUrl: options.apiUrl,
      fetch: net.fetch as typeof fetch
    })
    const result = await client.ocr({ filePath: file.path, model: 'PP-OCRv5' })
    const text = result.pages.flatMap((p) => (p.prunedResult as any)?.rec_texts ?? []).join('\n')
    return { text }
  }
}

export const ppocrService = new PpocrService()
