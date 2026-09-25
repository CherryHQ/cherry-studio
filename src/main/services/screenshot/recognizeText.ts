import { application } from '@application'
import { loggerService } from '@logger'
import type { OcrLine } from '@main/ai/localModel'
import { isMac, isWin } from '@main/core/platform'
import type { OcrRecognitionResult, OcrTextLine } from '@shared/ipc/schemas/screenshot'

const logger = loggerService.withContext('ScreenshotOcr')

export function isScreenshotOcrAvailable(): boolean {
  return isMac || isWin || application.get('LocalModelService').isCapabilityReady('ocr')
}

export async function recognizeScreenshotText(
  imageBytes: Uint8Array,
  size: { width: number; height: number }
): Promise<OcrRecognitionResult> {
  if (isMac || isWin) {
    try {
      // Keep a broken native binding from preventing screenshot capture at startup.
      const { recognize, OcrAccuracy } = await import('@napi-rs/system-ocr')
      const result = await recognize(imageBytes, OcrAccuracy.Accurate)
      return {
        status: 'ok',
        lines: result.lines.map(({ text, boundingBox }) => ({
          text,
          box: {
            x: boundingBox.x * size.width,
            y: boundingBox.y * size.height,
            width: boundingBox.width * size.width,
            height: boundingBox.height * size.height
          }
        }))
      }
    } catch (error) {
      if (!application.get('LocalModelService').isCapabilityReady('ocr')) throw error
      logger.warn('System OCR failed; falling back to the local model', error as Error)
    }
  }

  if (!application.get('LocalModelService').isCapabilityReady('ocr')) return { status: 'unavailable' }
  const result = await application.get('OcrInferenceService').recognize({ kind: 'bytes', imageBytes })
  return { status: 'ok', lines: result.lines.filter((words) => words.length > 0).map(mergePaddleLine) }
}

function mergePaddleLine(words: OcrLine[]): OcrTextLine {
  // Paddle adds recognition margins: 0.4 glyph heights vertically, 0.6 horizontally.
  // Native line bounds already describe the glyphs and must never be unpadded.
  const boxes = words.map(({ box }) => {
    const height = box.height / 1.8
    return {
      x: box.x + height * 0.6,
      y: box.y + height * 0.4,
      width: Math.max(0, box.width - height * 1.2),
      height
    }
  })
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return {
    text: words.map((word) => word.text).join(' '),
    box: { x: left, y: top, width: right - left, height: bottom - top }
  }
}
