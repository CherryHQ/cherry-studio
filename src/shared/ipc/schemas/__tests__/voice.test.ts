import { describe, expect, it } from 'vitest'

import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, WINDOWS_TTS_MODEL_ID } from '@shared/ai/localVoice'

import { voiceRequestSchemas } from '../voice'

const speech = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  text: 'Hello',
  voice: 'exact'
}

describe('voice speech IPC', () => {
  it('accepts explicit Apple and Windows speech model selection and a platform default', () => {
    for (const modelId of [APPLE_TTS_MODEL_ID, WINDOWS_TTS_MODEL_ID, undefined]) {
      expect(voiceRequestSchemas['ai.speech.generate'].input.safeParse({ ...speech, modelId }).success).toBe(true)
    }
    expect(
      voiceRequestSchemas['ai.speech.generate'].input.safeParse({ ...speech, modelId: APPLE_ASR_MODEL_ID }).success
    ).toBe(false)
    expect(
      voiceRequestSchemas['ai.voice.model.status'].input.safeParse({ modelId: WINDOWS_TTS_MODEL_ID }).success
    ).toBe(true)
  })

  it('accepts supported speech speeds and rejects out-of-range values', () => {
    for (const speed of [0.5, 1, 1.5, 2])
      expect(voiceRequestSchemas['ai.speech.generate'].input.safeParse({ ...speech, speed }).success).toBe(true)
    for (const speed of [0, 0.49, 2.01, Infinity, NaN])
      expect(voiceRequestSchemas['ai.speech.generate'].input.safeParse({ ...speech, speed }).success).toBe(false)
  })
})
