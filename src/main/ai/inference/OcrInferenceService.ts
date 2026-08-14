import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { OcrModelPaths } from './inferenceProtocol'
import { InferenceServiceBase } from './InferenceServiceBase'

/** Local OCR inference (PaddleOCR via ppu-paddle-ocr) in its own worker; see
 * {@link InferenceServiceBase} for the shared worker lifecycle. */
@Injectable('OcrInferenceService')
@ServicePhase(Phase.WhenReady)
export class OcrInferenceService extends InferenceServiceBase {
  constructor() {
    super('ocr')
  }

  /** OCR an image off the main thread; loads the PaddleOCR model first if not cached. */
  async recognize(modelPaths: OcrModelPaths, imagePath: string, signal?: AbortSignal): Promise<string> {
    const result = await this.send({ type: 'ocr.recognize', modelPaths, imagePath }, { signal })
    return result.text ?? ''
  }
}
