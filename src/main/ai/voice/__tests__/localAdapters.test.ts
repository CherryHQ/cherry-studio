import { describe, expect, it } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID,
  TranscriptionLanguageSource,
  VoiceModelSupport,
  VoiceResourceOperation
} from '@shared/ai/localVoice'

import { describeVoiceModel, listVoiceModels, resolveTranscriptionRequest } from '../localAdapters'

describe('device-scoped voice catalog and request policy', () => {
  it.each([
    [{ platform: 'darwin', arch: 'arm64', majorVersion: 26 }, [APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID]],
    [{ platform: 'win32', arch: 'x64' }, [WINDOWS_ASR_MODEL_ID, WINDOWS_TTS_MODEL_ID]],
    [{ platform: 'linux', arch: 'x64' }, []],
    [{ platform: 'win32', arch: 'arm64' }, []],
    [{ platform: 'darwin', arch: 'arm64', majorVersion: 12 }, []]
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

  it('resolves supported locale intent without substituting English', () => {
    expect(
      resolveTranscriptionRequest(
        { modelId: APPLE_ASR_MODEL_ID, language: { source: TranscriptionLanguageSource.Interface, locale: 'ja-JP' } },
        { platform: 'darwin', majorVersion: 26 }
      )
    ).toMatchObject({ options: { language: 'ja-JP' } })
  })
})
