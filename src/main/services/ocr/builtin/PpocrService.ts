import { loadOcrImage } from '@main/utils/ocr'
import { ImageFileMetadata, isImageFileMetadata, OcrPpocrConfig, OcrResult, SupportedOcrFile } from '@types'
import { net } from 'electron'
import { z } from 'zod'

import { OcrBaseService } from './OcrBaseService'

const OcrResponseSchema = z.object({
  result: z.object({
    ocrResults: z.array(
      z.object({
        prunedResult: z.object({
          rec_texts: z.array(z.string())
        })
      })
    )
  })
})

export class PpocrService extends OcrBaseService {
  public ocr = async (file: SupportedOcrFile, options?: OcrPpocrConfig): Promise<OcrResult> => {
    if (!isImageFileMetadata(file)) {
      throw new Error('Only image files are supported currently')
    }
    if (!options) {
      throw new Error('config is required')
    }
    return this.imageOcr(file, options)
  }

  private async imageOcr(file: ImageFileMetadata, options: OcrPpocrConfig): Promise<OcrResult> {
    if (!options.apiUrl) {
      throw new Error('API URL is required')
    }
    const apiUrl = options.apiUrl

    const buffer = await loadOcrImage(file)
    const base64 = buffer.toString('base64')
    const payload = {
      file: base64,
      fileType: 1,
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      visualize: false
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (options.aistudioAccessToken) {
      headers['Authorization'] = `token ${options.aistudioAccessToken}`
    }

    try {
      const response = await net.fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`OCR service error: ${response.status} ${response.statusText} - ${text}`)
      }

      const data = await response.json()

      const validatedResponse = OcrResponseSchema.parse(data)
      const recTexts = validatedResponse.result.ocrResults[0].prunedResult.rec_texts

      return { text: recTexts.join('\n') }
    } catch (error: any) {
      throw new Error(`OCR service error: ${error.message}`)
    }
  }
}

export const ppocrService = new PpocrService()
