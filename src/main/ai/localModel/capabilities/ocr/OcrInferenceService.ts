import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { type OcrInferenceContract, ocrInferenceProcess } from '../../runtime/inferenceProcess'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { resolveOcrModelPaths } from './modelPaths'
import type { OcrLine, OcrRecognizeSource } from './protocol'

/** Local OCR inference (PaddleOCR via ppu-paddle-ocr) in its own utility process. */
@Injectable('OcrInferenceService')
@ServicePhase(Phase.WhenReady)
export class OcrInferenceService extends InferenceServiceBase<OcrInferenceContract> {
  constructor() {
    super(ocrInferenceProcess, 'ocr')
  }

  /**
   * OCR an image off the main thread; loads the PaddleOCR model first if not cached.
   *
   * @returns the joined text plus the per-run boxes in the image's pixel space
   *   (empty when the engine reported none, so callers never branch on null).
   */
  async recognize(source: OcrRecognizeSource, signal?: AbortSignal): Promise<{ text: string; lines: OcrLine[][] }> {
    return this.run('recognize', { modelPaths: resolveOcrModelPaths(), source }, { signal })
  }
}
