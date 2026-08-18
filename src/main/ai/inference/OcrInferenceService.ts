import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { OcrLine, OcrModelPaths, OcrRecognizeSource } from './inferenceProtocol'
import { InferenceServiceBase } from './InferenceServiceBase'

/** Local OCR inference (PaddleOCR via ppu-paddle-ocr) in its own worker; see
 * {@link InferenceServiceBase} for the shared worker lifecycle. */
@Injectable('OcrInferenceService')
@ServicePhase(Phase.WhenReady)
export class OcrInferenceService extends InferenceServiceBase {
  constructor() {
    super('ocr')
  }

  /**
   * OCR an image off the main thread; loads the PaddleOCR model first if not cached.
   *
   * @returns the joined text plus the per-run boxes in the image's pixel space
   *   (empty when the engine reported none, so callers never branch on null).
   */
  async recognize(
    modelPaths: OcrModelPaths,
    source: OcrRecognizeSource,
    signal?: AbortSignal
  ): Promise<{ text: string; lines: OcrLine[][] }> {
    const result = await this.send({ type: 'ocr.recognize', modelPaths, source }, { signal })
    return { text: result.text ?? '', lines: result.lines ?? [] }
  }
}
