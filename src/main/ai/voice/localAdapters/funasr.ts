import { FUNASR_MODEL_ID, LOCAL_VOICE_MODELS, VoiceModelSupport } from '@shared/ai/localVoice'

import type { TranscriptionModelDefinition } from '../voiceModelTypes'
import { VoiceRuntimeError } from '../VoiceRuntimeError'

export const funAsrTranscriptionDefinition: TranscriptionModelDefinition = {
  id: FUNASR_MODEL_ID,
  adapterId: 'funasr',
  support: () => VoiceModelSupport.UnsupportedPlatform,
  describe: () => ({
    ...LOCAL_VOICE_MODELS.find((model) => model.id === FUNASR_MODEL_ID)!,
    localeSelection: null,
    resourceOperations: []
  }),
  status: () => ({ status: 'unsupported', reason: 'unsupported' }),
  locales: async () => ({ supported: [], installed: [] }),
  createModel: () => {
    throw new VoiceRuntimeError('unsupported')
  }
}
