import { describe, expect, it } from 'vitest'

import { voiceRequestSchemas } from '../voice'

const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  fileEntryId: '00000000-0000-4000-8000-000000000003',
  modelId: 'local-voice::apple-system-asr',
  language: 'en-US'
}

describe('Voice IPC input boundary', () => {
  it('accepts a FileEntry reference with standard language, rejects every alternate audio and routing surface', () => {
    const schema = voiceRequestSchemas['ai.transcription.generate'].input
    expect(schema.parse(input)).toEqual(input)
    for (const extra of [
      { path: '/private/audio.webm' },
      { audio: new Uint8Array([1]) },
      { bytes: [1] },
      { base64: 'YQ==' },
      { adapter: 'apple' },
      { providerOptions: {} },
      { ownerWindowId: 'other' }
    ]) {
      expect(schema.safeParse({ ...input, ...extra }).success).toBe(false)
    }
    expect(schema.safeParse({ ...input, fileEntryId: undefined }).success).toBe(false)
    expect(schema.safeParse({ ...input, modelId: 'openai::whisper-1' }).success).toBe(false)
  })

  it('restricts recording registration to bounded WebM/Opus bytes and speech to an exact voice', () => {
    const recording = voiceRequestSchemas['file.voice_recording.create'].input
    const payload = { sessionId: input.sessionId, audio: new Uint8Array([1, 2]), mimeType: 'audio/webm;codecs=opus' }
    expect(recording.safeParse(payload).success).toBe(true)
    expect(recording.safeParse({ ...payload, mimeType: 'audio/wav' }).success).toBe(false)
    expect(recording.safeParse({ ...payload, path: '/tmp/voice' }).success).toBe(false)
    const speech = voiceRequestSchemas['ai.speech.generate'].input
    expect(
      speech.safeParse({
        sessionId: input.sessionId,
        requestId: input.requestId,
        text: 'hello',
        modelId: 'local-voice::apple-system-tts'
      }).success
    ).toBe(false)
  })
})
