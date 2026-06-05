import type { OcrHandler, OcrTaskResultHandler, OcrTaskStartHandler, OcrTaskStatusHandler } from '@types'

export abstract class OcrBaseService {
  ocr?: OcrHandler
  startTask?: OcrTaskStartHandler
  getTaskStatus?: OcrTaskStatusHandler
  getTaskResult?: OcrTaskResultHandler
}
