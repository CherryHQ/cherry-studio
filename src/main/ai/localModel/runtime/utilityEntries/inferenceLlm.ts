import type { LlmInferenceContract, LlmInitData } from '@main/ai/localModel/capabilities/llm/protocol'
import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { disposeLlm, initializeLlm, llmHandlers } from './inferenceLlmHandlers'

serveUtilityProcess<LlmInferenceContract, LlmInitData>({
  id: 'inference.llm',
  initialize: initializeLlm,
  handlers: llmHandlers,
  dispose: disposeLlm
})
