import type { TtsInferenceContract, TtsInitData } from '@main/ai/localModel/capabilities/tts/protocol'
import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { disposeTts, initializeTts, ttsHandlers, ttsStreamHandlers } from './inferenceTtsHandlers'

serveUtilityProcess<TtsInferenceContract, TtsInitData>({
  id: 'inference.tts',
  initialize: initializeTts,
  handlers: ttsHandlers,
  streams: ttsStreamHandlers,
  dispose: disposeTts
})
