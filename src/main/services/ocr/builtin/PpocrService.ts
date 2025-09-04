import { loadOcrImage } from '@main/utils/ocr'
import { ImageFileMetadata, isImageFileMetadata, OcrPpocrConfig, OcrResult, SupportedOcrFile } from '@types'
import axios from 'axios'

import { OcrBaseService } from './OcrBaseService'

interface PpocrResponse {
  logId: string
  result: {
    ocrResults: Array<{
      prunedResult: {
        rec_texts: string[]
      }
    }>
  }
  errorCode: number
  errorMsg: string
}

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
      const response = await axios.post<PpocrResponse>(apiUrl, payload, {
        headers
      })

      const result = response.data?.result

      // 严格校验
      if (!result) {
        throw new Error("OCR response missing 'result' field")
      }

      if (!Array.isArray(result.ocrResults) || result.ocrResults.length === 0) {
        throw new Error("OCR response has no 'ocrResults'")
      }

      const recTexts = result.ocrResults[0]?.prunedResult?.rec_texts

      if (!Array.isArray(recTexts)) {
        throw new Error("OCR response has no 'rec_texts'")
      }

      return { text: recTexts.join(' ') }
    } catch (error: any) {
      throw new Error(`OCR service error: ${error.message}`)
    }
  }
}

export const ppocrService = new PpocrService()
