import { loadOcrImage } from '@main/utils/ocr'
import { ImageFileMetadata, isImageFileMetadata, OcrPpocrConfig, OcrResult, SupportedOcrFile } from '@types'
import { net } from 'electron'
import { z } from 'zod'

import { OcrBaseService } from './OcrBaseService'

enum FileType {
  PDF = 0,
  Image = 1
}

// API Reference: https://www.paddleocr.ai/latest/version3.x/pipeline_usage/OCR.html#3
interface OcrPayload {
  file: string
  fileType?: FileType | null
  useDocOrientationClassify?: boolean | null
  useDocUnwarping?: boolean | null
  useTextlineOrientation?: boolean | null
  textDetLimitSideLen?: number | null
  textDetLimitType?: string | null
  textDetThresh?: number | null
  textDetBoxThresh?: number | null
  textDetUnclipRatio?: number | null
  textRecScoreThresh?: number | null
  visualize?: boolean | null
}

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
      fileType: FileType.Image,
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      visualize: false
    } satisfies OcrPayload

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (options.accessToken) {
      headers['Authorization'] = `token ${options.accessToken}`
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
