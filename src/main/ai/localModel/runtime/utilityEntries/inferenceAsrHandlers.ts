import { AsrEngine } from '@main/ai/localModel/capabilities/asr/protocol'
import type { AsrInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { transcribeFunAsr } from './inferenceFunAsr'
import { transcribeQwen3Asr } from './inferenceQwen3Asr'

export const asrHandlers: UtilityProcessHandlers<AsrInferenceContract> = {
  transcribe(input, context) {
    switch (input.engine) {
      case AsrEngine.Sherpa:
        return transcribeFunAsr(input, context)
      case AsrEngine.Mlx:
        return transcribeQwen3Asr(input, context)
    }
  }
}
