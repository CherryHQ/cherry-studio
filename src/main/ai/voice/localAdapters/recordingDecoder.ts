import { application } from '@application'

import { VoiceRuntimeError } from '../VoiceRuntimeError'
import { voiceAudioProcess } from './voiceAudioProcess'

export async function decodeVoiceRecording(audio: Uint8Array, callerSignal?: AbortSignal) {
  const timeout = AbortSignal.timeout(30_000)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
  return application
    .get('UtilityProcessManager')
    .client(voiceAudioProcess)
    .request('decode', { audio, mimeType: 'audio/webm;codecs=opus' }, { signal })
    .catch((error: unknown) => {
      if (timeout.aborted && !callerSignal?.aborted) throw new VoiceRuntimeError('timeout')
      throw error
    })
}
