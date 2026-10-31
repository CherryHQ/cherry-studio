import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { decodeWebm } from '../decodeWebm'
import type { VoiceAudioContract } from '../voiceAudioProcess'

serveUtilityProcess<VoiceAudioContract>({
  id: 'voice.audio',
  handlers: { decode: (input, { signal }) => decodeWebm(input, signal) }
})
