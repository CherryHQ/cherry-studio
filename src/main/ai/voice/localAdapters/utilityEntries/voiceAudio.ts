import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { decodeOgg } from '../decodeOgg'
import { decodeWebm } from '../decodeWebm'
import type { VoiceAudioContract, VoiceAudioInput, VoiceAudioResult } from '../voiceAudioProcess'

export function decodeVoiceAudio(input: VoiceAudioInput, signal?: AbortSignal): Promise<VoiceAudioResult> {
  const mimeType = input.mimeType.toLowerCase().replace(/\s/g, '')
  if (mimeType === 'audio/ogg' || mimeType === 'audio/ogg;codecs=opus' || mimeType === 'audio/ogg;codecs="opus"')
    return decodeOgg({ ...input, mimeType }, signal)
  if (mimeType === 'audio/webm;codecs=opus') return decodeWebm({ ...input, mimeType }, signal)
  return decodeWebm(input, signal)
}

serveUtilityProcess<VoiceAudioContract>({
  id: 'voice.audio',
  handlers: { decode: (input, { signal }) => decodeVoiceAudio(input, signal) }
})
