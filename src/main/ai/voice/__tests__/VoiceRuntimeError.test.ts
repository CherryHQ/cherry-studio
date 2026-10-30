import { describe, expect, it } from 'vitest'

import { VoiceRuntimeError, voiceIpcError } from '../VoiceRuntimeError'

describe('voice error boundary', () => {
  it('drops unknown messages, causes, transcripts, paths and provider responses', () => {
    const sensitive = new Error('/Users/private/audio.webm transcript-secret TTS-secret', {
      cause: { response: 'provider-secret' }
    })
    const result = voiceIpcError(sensitive).toJSON()
    expect(result).toEqual({
      code: 'VOICE_OPERATION_FAILED',
      message: 'operation_failed',
      data: { reason: 'operation_failed' }
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|Users|response|cause/)
  })

  it('keeps a stable resource remediation reason through serialization', () => {
    expect(voiceIpcError(new VoiceRuntimeError('asset_required')).toJSON()).toEqual({
      code: 'VOICE_ASSET_REQUIRED',
      message: 'asset_required',
      data: { reason: 'asset_required' }
    })
  })
})
