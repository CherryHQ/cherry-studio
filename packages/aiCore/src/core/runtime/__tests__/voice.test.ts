import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'

import { generateSpeech, transcribe } from '../voice'

const wav = Uint8Array.from(
  Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex')
)
const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x80])
const response = { timestamp: new Date(0), modelId: 'test-model', body: { secret: 'provider-response' } }

function speechModel(doGenerate: SpeechModelV3['doGenerate']): SpeechModelV3 {
  return { specificationVersion: 'v3', provider: 'test-local', modelId: 'tts', doGenerate }
}

function transcriptionModel(doGenerate: TranscriptionModelV3['doGenerate']): TranscriptionModelV3 {
  return { specificationVersion: 'v3', provider: 'test-local', modelId: 'asr', doGenerate }
}

describe('one-shot voice operations', () => {
  it('returns WAV bytes without request, warning or provider-response metadata', async () => {
    const model = speechModel(async ({ text, voice, language, speed, outputFormat }) => {
      expect({ text, voice, language, speed, outputFormat }).toEqual({
        text: 'Private speech',
        voice: 'exact-installed-voice',
        language: 'en-US',
        speed: 1,
        outputFormat: 'wav'
      })
      return { audio: wav, warnings: [], response, request: { body: 'Private speech' } }
    })
    expect(
      await generateSpeech(
        model,
        'Private speech',
        { voice: 'exact-installed-voice', language: 'en-US', speed: 1 },
        new AbortController().signal
      )
    ).toEqual({ audio: wav, mediaType: 'audio/wav' })
  })

  it('passes WebM audio and standard language without exposing provider metadata', async () => {
    const model = transcriptionModel(async ({ audio, mediaType, providerOptions }) => {
      expect(audio).toEqual(webm)
      expect(mediaType).toBe('audio/webm')
      expect(providerOptions).toEqual({ 'test-local': { language: 'en-US' } })
      return {
        text: 'Private transcript',
        segments: [{ text: 'Private transcript', startSecond: 0, endSecond: 1 }],
        language: 'en',
        durationInSeconds: 1,
        warnings: [],
        response
      }
    })
    expect(await transcribe(model, webm, { language: 'en-US' }, new AbortController().signal)).toEqual({
      text: 'Private transcript',
      segments: [{ text: 'Private transcript', startSecond: 0, endSecond: 1 }],
      language: 'en',
      durationInSeconds: 1
    })
  })

  it('does not retry a failed operation', async () => {
    let attempts = 0
    const failure = new APICallError({
      message: 'unavailable',
      url: 'local:test',
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true
    })
    const model = speechModel(async () => {
      attempts += 1
      throw failure
    })
    await expect(
      generateSpeech(model, 'Private speech', { voice: 'exact-installed-voice' }, new AbortController().signal)
    ).rejects.toBe(failure)
    expect(attempts).toBe(1)
  })

  it('rejects implicit provider resolution and audio URLs', async () => {
    const signal = new AbortController().signal
    await expect(
      generateSpeech('implicit-model' as unknown as SpeechModelV3, 'text', { voice: 'voice' }, signal)
    ).rejects.toThrow('Speech requires a resolved V3 model')
    await expect(transcribe('implicit-model' as unknown as TranscriptionModelV3, webm, {}, signal)).rejects.toThrow(
      'Transcription requires a resolved V3 model'
    )
    const model = transcriptionModel(async () => {
      throw new Error('Unexpected adapter call')
    })
    await expect(
      transcribe(model, new URL('https://example.invalid/audio.webm') as unknown as Uint8Array, {}, signal)
    ).rejects.toThrow('Transcription requires audio bytes')
  })

  it('refuses pre-aborted work before entering the adapter', async () => {
    let entered = false
    const model = transcriptionModel(async () => {
      entered = true
      throw new Error('Unexpected adapter call')
    })
    const controller = new AbortController()
    controller.abort()
    await expect(transcribe(model, webm, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(entered).toBe(false)
  })

  it('cancels in-flight work with the original abort reason', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const model = speechModel(
      ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal!.addEventListener('abort', () => reject(abortSignal!.reason), { once: true })
          controller.abort(reason)
        })
    )
    await expect(
      generateSpeech(model, 'Private speech', { voice: 'exact-installed-voice' }, controller.signal)
    ).rejects.toBe(reason)
  })

  it('does not accept a non-WAV speech result', async () => {
    const model = speechModel(async () => ({
      audio: Uint8Array.from([0x49, 0x44, 0x33, 0, 0]),
      warnings: [],
      response
    }))
    await expect(
      generateSpeech(model, 'Private speech', { voice: 'exact-installed-voice' }, new AbortController().signal)
    ).rejects.toThrow('Speech output must be WAV')
  })
})
