import type { AsrInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { InferenceInitData } from '@main/ai/localModel/runtime/protocol'
import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { asrHandlers } from './inferenceAsrHandlers'
import { asrStreamHandlers } from './inferenceQwen3Asr'
import { applyInitData, disposeCachedResources } from './inferenceRuntime'

serveUtilityProcess<AsrInferenceContract, InferenceInitData>({
  id: 'inference.asr',
  initialize: (initData) => applyInitData(initData),
  handlers: asrHandlers,
  streams: asrStreamHandlers,
  dispose: ({ logger }) => disposeCachedResources(logger)
})
