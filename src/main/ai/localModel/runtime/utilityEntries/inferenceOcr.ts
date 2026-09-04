/**
 * OCR inference entry (PaddleOCR via ppu-paddle-ocr), one process per app.
 */

import type { OcrInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { InferenceInitData } from '@main/ai/localModel/runtime/protocol'
import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { ocrHandlers } from './inferenceOcrHandlers'
import { applyInitData, disposeCachedResources } from './inferenceRuntime'

serveUtilityProcess<OcrInferenceContract, InferenceInitData>({
  id: 'inference.ocr',
  initialize: (initData) => applyInitData(initData),
  handlers: ocrHandlers,
  dispose: ({ logger }) => disposeCachedResources(logger)
})
