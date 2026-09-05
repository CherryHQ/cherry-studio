import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { bundleForCapability } from '../../catalog/catalog'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import { onnxRuntimeWorkerSource } from '../../runtime/worker/onnxRuntime'
import { resolveOcrModelPaths } from './modelPaths'
import {
  OCR_RESULT_KEYS,
  type OcrLine,
  type OcrRecognizeSource,
  type OcrRequestPayloads,
  type OcrResultPayloads
} from './protocol'
import { ocrWorkerSource } from './worker'

/** Local OCR inference (PaddleOCR via ppu-paddle-ocr) in its own worker; see
 * {@link InferenceServiceBase} for the shared worker lifecycle. */
@Injectable('OcrInferenceService')
@ServicePhase(Phase.WhenReady)
export class OcrInferenceService extends InferenceServiceBase<'ocr', OcrRequestPayloads, OcrResultPayloads> {
  constructor() {
    const bundle = bundleForCapability('ocr')
    super({
      capability: 'ocr',
      sharedArtifacts: bundle.requires,
      runtimeModuleSource: onnxRuntimeWorkerSource,
      workerModuleSource: ocrWorkerSource,
      resultKeys: OCR_RESULT_KEYS
    })
  }

  /**
   * OCR an image off the main thread; loads the PaddleOCR model first if not cached.
   *
   * @returns the joined text plus the per-run boxes in the image's pixel space
   *   (empty when the engine reported none, so callers never branch on null).
   */
  async recognize(source: OcrRecognizeSource, signal?: AbortSignal): Promise<{ text: string; lines: OcrLine[][] }> {
    return this.send('recognize', { modelPaths: resolveOcrModelPaths(), source }, { signal })
  }
}
