import { describe, expect, it } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  KOKORO_TTS_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID,
  TranscriptionLanguageSource,
  VoiceModelSupport,
  VoiceResourceOperation
} from '@shared/ai/localVoice'
import { SpeechInputKind, SpeechOutputKind, TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'
import { voiceRequestSchemas } from '@shared/ipc/schemas/voice'

import { describeVoiceModel, listVoiceModels, resolveTranscriptionRequest } from '../localAdapters'

describe('device-scoped voice catalog and request policy', () => {
  it('advertises implemented audio and PCM operations through the IPC contract', () => {
    const catalog = listVoiceModels({ platform: 'darwin', arch: 'arm64', majorVersion: 26, minorVersion: 3 })
    expect(voiceRequestSchemas['ai.voice.models.list'].output.safeParse(catalog).success).toBe(true)
    expect(catalog.models.find((model) => model.id === APPLE_TTS_MODEL_ID)?.voiceCapabilities).toEqual({
      speech: [
        { input: SpeechInputKind.Text, output: SpeechOutputKind.Audio },
        { input: SpeechInputKind.Text, output: SpeechOutputKind.PcmStream }
      ]
    })
    expect(catalog.models.find((model) => model.id === FUNASR_MODEL_ID)?.voiceCapabilities).toEqual({
      transcription: [{ input: TranscriptionInputKind.Audio, output: TranscriptionOutputKind.Final }]
    })
    expect(
      voiceRequestSchemas['ai.voice.models.list'].output.safeParse({
        ...catalog,
        models: [{ ...catalog.models[0], voiceCapabilities: { speech: [{ input: 'text', output: 'pcm_stream' }] } }]
      }).success
    ).toBe(false)
  })
  it.each([
    [
      { platform: 'darwin', arch: 'arm64', majorVersion: 26 },
      [APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID, KOKORO_TTS_MODEL_ID]
    ],
    [
      { platform: 'win32', arch: 'x64' },
      [WINDOWS_ASR_MODEL_ID, WINDOWS_TTS_MODEL_ID, FUNASR_MODEL_ID, KOKORO_TTS_MODEL_ID]
    ],
    [{ platform: 'linux', arch: 'x64' }, [FUNASR_MODEL_ID, KOKORO_TTS_MODEL_ID]],
    [{ platform: 'win32', arch: 'arm64' }, [FUNASR_MODEL_ID, KOKORO_TTS_MODEL_ID]],
    [{ platform: 'darwin', arch: 'arm64', majorVersion: 12 }, [FUNASR_MODEL_ID, KOKORO_TTS_MODEL_ID]]
  ])('offers only runnable models on %j', (environment, expected) => {
    const catalog = listVoiceModels(environment)
    expect(catalog.models.map((model) => model.id).sort()).toEqual([...expected].sort())
    if (catalog.defaultAsrModelId) expect(expected).toContain(catalog.defaultAsrModelId)
    if (catalog.defaultSpeechModelId) expect(expected).toContain(catalog.defaultSpeechModelId)
  })

  it('preserves the identity and support reason of saved unavailable models', () => {
    expect(
      describeVoiceModel(WINDOWS_ASR_MODEL_ID, { platform: 'darwin', arch: 'arm64', majorVersion: 26 })
    ).toMatchObject({ support: VoiceModelSupport.UnsupportedPlatform, model: { id: WINDOWS_ASR_MODEL_ID } })
    expect(describeVoiceModel(WINDOWS_ASR_MODEL_ID, { platform: 'win32', arch: 'arm64' }).support).toBe(
      VoiceModelSupport.UnsupportedArchitecture
    )
    expect(describeVoiceModel('removed-model')).toEqual({ support: VoiceModelSupport.UnknownModel, model: null })
  })

  it('offers Apple locale installation only on supported OS versions', () => {
    expect(
      describeVoiceModel(APPLE_ASR_MODEL_ID, { platform: 'darwin', majorVersion: 15 }).model?.resourceOperations
    ).toEqual([])
    expect(
      describeVoiceModel(APPLE_ASR_MODEL_ID, { platform: 'darwin', majorVersion: 26 }).model?.resourceOperations
    ).toContain(VoiceResourceOperation.InstallLocale)
  })

  it('drops interface locale intent for automatic detection but rejects an explicit locale', () => {
    const environment = { platform: 'linux', arch: 'x64' }
    expect(
      resolveTranscriptionRequest(
        { language: { source: TranscriptionLanguageSource.Interface, locale: 'ja-JP' } },
        environment
      )
    ).toMatchObject({ modelId: FUNASR_MODEL_ID, options: { language: undefined } })
    expect(() =>
      resolveTranscriptionRequest(
        { modelId: FUNASR_MODEL_ID, language: { source: TranscriptionLanguageSource.Explicit, locale: 'ja-JP' } },
        environment
      )
    ).toThrow('invalid_request')
    expect(() => resolveTranscriptionRequest({ modelId: APPLE_ASR_MODEL_ID }, environment)).toThrow('unsupported')
  })

  it('resolves supported locale intent without substituting English', () => {
    expect(
      resolveTranscriptionRequest(
        { modelId: APPLE_ASR_MODEL_ID, language: { source: TranscriptionLanguageSource.Interface, locale: 'ja-JP' } },
        { platform: 'darwin', majorVersion: 26 }
      )
    ).toMatchObject({ options: { language: 'ja-JP' } })
  })
})
