import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID } from '@shared/ai/localVoice'

const models = vi.hoisted(() => ({
  speech: undefined as SpeechModelV3 | undefined,
  transcription: undefined as TranscriptionModelV3 | undefined
}))

vi.mock('../voice/localAdapters', () => ({
  createLocalSpeechModel: () => models.speech,
  createLocalTranscriptionModel: () => models.transcription
}))

import { AiService } from '../AiService'

const wav = Uint8Array.from(
  Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex')
)

beforeEach(() => {
  BaseService.resetInstances()
  vi.clearAllMocks()
})

describe('AiService voice operations through real aiCore', () => {
  it('returns the selected local model output without provider-response metadata', async () => {
    models.speech = {
      specificationVersion: 'v3',
      provider: 'test-local',
      modelId: APPLE_TTS_MODEL_ID,
      doGenerate: async ({ text, voice }) => {
        expect(text).toBe('PRIVATE-TTS-TEXT')
        expect(voice).toBe('exact-voice')
        return {
          audio: wav,
          warnings: [],
          response: { timestamp: new Date(0), modelId: APPLE_TTS_MODEL_ID, body: { sensitive: 'PRIVATE-TTS-TEXT' } }
        }
      }
    }
    const result = await new AiService().generateSpeech(
      APPLE_TTS_MODEL_ID,
      'PRIVATE-TTS-TEXT',
      { voice: 'exact-voice' },
      new AbortController().signal
    )
    expect(result).toEqual({ audio: wav, mediaType: 'audio/wav' })
    const logs = JSON.stringify([
      mockMainLoggerService.info.mock.calls,
      mockMainLoggerService.error.mock.calls,
      mockMainLoggerService.warn.mock.calls,
      mockMainLoggerService.debug.mock.calls,
      mockMainLoggerService.verbose.mock.calls,
      mockMainLoggerService.silly.mock.calls
    ])
    expect(logs).not.toContain('PRIVATE-TTS-TEXT')
  })

  it('returns transcription through the local model with no text or paths in logs', async () => {
    models.transcription = {
      specificationVersion: 'v3',
      provider: 'test-local',
      modelId: APPLE_ASR_MODEL_ID,
      doGenerate: async () => ({
        text: 'PRIVATE-TRANSCRIPT',
        segments: [],
        language: 'en',
        durationInSeconds: 1,
        warnings: [],
        response: { timestamp: new Date(0), modelId: APPLE_ASR_MODEL_ID, body: '/private/recording.webm' }
      })
    }
    const result = await new AiService().transcribe(
      APPLE_ASR_MODEL_ID,
      Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]),
      { language: 'en-US' },
      new AbortController().signal
    )
    expect(result).toEqual({ text: 'PRIVATE-TRANSCRIPT', segments: [], language: 'en', durationInSeconds: 1 })
    const logs = JSON.stringify([
      mockMainLoggerService.info.mock.calls,
      mockMainLoggerService.error.mock.calls,
      mockMainLoggerService.warn.mock.calls,
      mockMainLoggerService.debug.mock.calls,
      mockMainLoggerService.verbose.mock.calls,
      mockMainLoggerService.silly.mock.calls
    ])
    expect(logs).not.toContain('PRIVATE-TRANSCRIPT')
    expect(logs).not.toContain('/private/recording.webm')
  })
})
