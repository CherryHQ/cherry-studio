import type { AsrInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { InferenceInitData } from '@main/ai/localModel/runtime/protocol'
import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { asrHandlers } from './inferenceAsrHandlers'
import { applyInitData, disposeCachedResources } from './inferenceRuntime'

serveUtilityProcess<AsrInferenceContract, InferenceInitData>({
  id: 'inference.asr',
  initialize: (initData, { logger }) => applyInitData(initData, logger),
  handlers: asrHandlers,
  dispose: ({ logger }) => disposeCachedResources(logger)
})
