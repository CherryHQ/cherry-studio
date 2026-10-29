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

describe('streaming dictation IPC boundary', () => {
  const identity = {
    sessionId: '5f0507e3-c033-4b54-812c-68ae5b654d4e',
    requestId: '6b4303a9-c950-4401-ab8b-0ca3be75d60c'
  }
  it('accepts a partial mono batch but rejects oversized, non-finite and unsequenced input', () => {
    const schema = voiceRequestSchemas['ai.voice.input.write'].input
    expect(schema.safeParse({ ...identity, startFrame: 1600, samples: new Float32Array(131) }).success).toBe(true)
    for (const samples of [new Float32Array(0), new Float32Array(1601), new Float32Array([NaN])])
      expect(schema.safeParse({ ...identity, startFrame: 0, samples }).success).toBe(false)
    expect(schema.safeParse({ ...identity, startFrame: -1, samples: new Float32Array(1) }).success).toBe(false)
    expect(
      schema.safeParse({ sessionId: identity.sessionId, startFrame: 0, samples: new Float32Array(1) }).success
    ).toBe(false)
  })
})
