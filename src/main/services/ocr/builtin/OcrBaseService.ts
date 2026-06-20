import type { OcrHandler } from '@shared/types/ocr'

export abstract class OcrBaseService {
  abstract ocr: OcrHandler
}
