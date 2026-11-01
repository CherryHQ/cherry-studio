import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, WINDOWS_ASR_MODEL_ID } from '@shared/ai/localVoice'

const models = vi.hoisted(() => ({
  speech: undefined as SpeechModelV3 | undefined,
  transcription: undefined as TranscriptionModelV3 | undefined
}))

vi.mock('../localAdapters', async () => {
  const { completeSpeechOperation, completeTranscriptionOperation } = await import('../localAdapters/sdkOperations')
  return {
    getSpeechOperations: () => [
      completeSpeechOperation(() => {
        if (!models.speech) throw new Error('Speech model missing')
        return models.speech
      })
    ],
    getTranscriptionOperations: () => [
      completeTranscriptionOperation(() => {
        if (!models.transcription) throw new Error('Transcription model missing')
        return models.transcription
      })
    ]
  }
})

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import type { LocalSpeechModelId, LocalTranscriptionModelId } from '@shared/ai/localVoice'
import { SpeechInputKind, SpeechOutputKind, TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'

import { startSpeech, startTranscription } from '../execution'
import type { SpeechRequest, TranscriptionRequest } from '../executionTypes'
import { VoiceRuntimeError, voiceIpcError } from '../VoiceRuntimeError'

async function generateSpeech(modelId: LocalSpeechModelId, text: string, options: SpeechOptions, signal: AbortSignal) {
  const execution = startSpeech(
    { modelId, input: { kind: SpeechInputKind.Text, text }, output: SpeechOutputKind.Audio, options },
    signal
  )
  const result = await execution.output
  await execution.closed
  return result
}

function transcribe(
  modelId: LocalTranscriptionModelId,
  audio: Uint8Array,
  options: TranscriptionOptions,
  signal: AbortSignal
) {
  return startTranscription(
    { modelId, input: { kind: TranscriptionInputKind.Audio, audio }, output: TranscriptionOutputKind.Final, options },
    signal
  ).completed
}

const wav = Uint8Array.from(
  Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex')
)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('complete voice execution through real aiCore', () => {
  it('rejects input/output combinations that the selected operation does not implement', () => {
    expect(() =>
      startSpeech({
        modelId: APPLE_TTS_MODEL_ID,
        input: { kind: SpeechInputKind.Text, text: 'Hello' },
        output: 'pcm_stream',
        options: { voice: 'exact' }
      } as unknown as SpeechRequest)
    ).toThrow('unsupported')
    expect(() =>
      startTranscription({
        modelId: APPLE_ASR_MODEL_ID,
        input: { kind: 'pcm_stream', audio: wav },
        output: TranscriptionOutputKind.Final,
        options: {}
      } as unknown as TranscriptionRequest)
    ).toThrow('unsupported')
  })
  it.each([
    [APPLE_ASR_MODEL_ID, ''],
    [APPLE_ASR_MODEL_ID, ' \n\t '],
    [WINDOWS_ASR_MODEL_ID, ''],
    [WINDOWS_ASR_MODEL_ID, ' \n\t ']
  ] as const)('reports no speech for %s with an empty or blank transcript (%j)', async (modelId, text) => {
    models.transcription = {
      specificationVersion: 'v3',
      provider: 'test-local',
      modelId,
      doGenerate: async () => ({
        text,
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: { timestamp: new Date(0), modelId, body: '/private/recording.webm' }
      })
    }

    const error = await transcribe(modelId, wav, {}, new AbortController().signal).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(VoiceRuntimeError)
    expect(error).toMatchObject({ reason: 'no_speech', message: 'no_speech' })
    expect(error).not.toHaveProperty('responses')
    expect(error).not.toHaveProperty('cause')
    expect(voiceIpcError(error).toJSON()).toEqual({
      code: 'VOICE_NO_SPEECH',
      message: 'no_speech',
      data: { reason: 'no_speech' }
    })
  })

  it('preserves other transcription errors', async () => {
    const failure = new Error('recognizer failed')
    models.transcription = {
      specificationVersion: 'v3',
      provider: 'test-local',
      modelId: APPLE_ASR_MODEL_ID,
      doGenerate: async () => {
        throw failure
      }
    }

    await expect(transcribe(APPLE_ASR_MODEL_ID, wav, {}, new AbortController().signal)).rejects.toBe(failure)
  })

  it('preserves cancellation when the recognizer returns no transcript', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Transcription cancelled', 'AbortError')
    models.transcription = {
      specificationVersion: 'v3',
      provider: 'test-local',
      modelId: APPLE_ASR_MODEL_ID,
      doGenerate: async () => {
        controller.abort(reason)
        return {
          text: '',
          segments: [],
          language: undefined,
          durationInSeconds: undefined,
          warnings: [],
          response: { timestamp: new Date(0), modelId: APPLE_ASR_MODEL_ID }
        }
      }
    }

    await expect(transcribe(APPLE_ASR_MODEL_ID, wav, {}, controller.signal)).rejects.toBe(reason)
  })

  it('returns speech output without logging private input', async () => {
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
    const result = await generateSpeech(
      APPLE_TTS_MODEL_ID,
      'PRIVATE-TTS-TEXT',
      { voice: 'exact-voice' },
      new AbortController().signal
    )
    expect(result).toEqual({ kind: SpeechOutputKind.Audio, audio: wav, mediaType: 'audio/wav' })
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

  it.each([APPLE_ASR_MODEL_ID, WINDOWS_ASR_MODEL_ID])(
    'returns %s transcription with no text or paths in logs',
    async (modelId) => {
      models.transcription = {
        specificationVersion: 'v3',
        provider: 'test-local',
        modelId,
        doGenerate: async () => ({
          text: 'PRIVATE-TRANSCRIPT',
          segments: [],
          language: 'en',
          durationInSeconds: 1,
          warnings: [],
          response: { timestamp: new Date(0), modelId, body: '/private/recording.webm' }
        })
      }
      const result = await transcribe(
        modelId,
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
    }
  )

  it('delivers canonical PCM WAV through transcribe as audio/wav', async () => {
    let delivered: { audio: Uint8Array; mediaType: string } | undefined
    models.transcription = {
      specificationVersion: 'v3',
      provider: 'test-local',
      modelId: APPLE_ASR_MODEL_ID,
      doGenerate: async ({ audio, mediaType }) => {
        expect(audio).toBeInstanceOf(Uint8Array)
        if (!(audio instanceof Uint8Array)) throw new TypeError('expected canonical WAV bytes')
        delivered = { audio, mediaType }
        return {
          text: 'canonical transcript',
          segments: [],
          language: undefined,
          durationInSeconds: undefined,
          warnings: [],
          response: { timestamp: new Date(0), modelId: APPLE_ASR_MODEL_ID }
        }
      }
    }

    const result = await transcribe(APPLE_ASR_MODEL_ID, wav, {}, new AbortController().signal)

    expect(delivered).toEqual({ audio: wav, mediaType: 'audio/wav' })
    expect(result).toEqual({ text: 'canonical transcript', segments: [] })
  })
})
