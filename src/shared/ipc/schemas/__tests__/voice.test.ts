import { describe, expect, it } from 'vitest'

import { KOKORO_TTS_MODEL_ID } from '@shared/ai/localVoice'

import { voiceRequestSchemas } from '../voice'

describe('Kokoro speech IPC', () => {
  it('accepts the same downloadable model identity for synthesis, voice listing and configuration', () => {
    const modelId = KOKORO_TTS_MODEL_ID
    expect(
      voiceRequestSchemas['ai.speech.generate'].input.parse({
        sessionId: '5f0507e3-c033-4b54-812c-68ae5b654d4e',
        requestId: '6b4303a9-c950-4401-ab8b-0ca3be75d60c',
        modelId,
        text: '你好 Hello',
        voice: 'zf_001',
        language: 'zh-CN',
        speed: 1
      })
    ).toMatchObject({ modelId, text: '你好 Hello' })
    expect(voiceRequestSchemas['ai.speech.voices.list'].input.parse({ modelId })).toEqual({ modelId })
    expect(voiceRequestSchemas['ai.voice.speech.resolve'].input.parse({ modelId, language: 'zh-CN' })).toMatchObject({
      modelId
    })
  })
})
