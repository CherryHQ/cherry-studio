import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  TranscriptionLanguageSource,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'

import { resolveSpeechConfiguration, resolveTranscriptionConfiguration } from '../localAdapters'
import { appleSpeechDefinition, appleTranscriptionDefinition } from '../localAdapters/apple'
import { funAsrTranscriptionDefinition } from '../localAdapters/funasr'
import { windowsSpeechDefinition, windowsTranscriptionDefinition } from '../localAdapters/windows'

const mac = { platform: 'darwin', arch: 'arm64', majorVersion: 26 }
const language = { source: TranscriptionLanguageSource.Interface, locale: 'zh-CN' } as const

afterEach(() => vi.restoreAllMocks())

describe('voice product defaults', () => {
  it('uses an installed local recognizer when the system language resource is missing', async () => {
    vi.spyOn(appleTranscriptionDefinition, 'status').mockResolvedValue({
      status: 'not_installed',
      reason: 'asset_required'
    })
    vi.spyOn(funAsrTranscriptionDefinition, 'status').mockResolvedValue({ status: 'ready' })
    expect(await resolveTranscriptionConfiguration({ language }, undefined, mac)).toEqual({
      modelId: FUNASR_MODEL_ID,
      language: { source: TranscriptionLanguageSource.ModelDefault },
      status: { status: 'ready' }
    })
  })

  it('keeps an explicit unavailable choice instead of using another installed engine', async () => {
    vi.spyOn(appleTranscriptionDefinition, 'status').mockResolvedValue({
      status: 'not_installed',
      reason: 'asset_required'
    })
    vi.spyOn(funAsrTranscriptionDefinition, 'status').mockResolvedValue({ status: 'ready' })
    expect(
      await resolveTranscriptionConfiguration({ modelId: APPLE_ASR_MODEL_ID, language }, undefined, mac)
    ).toMatchObject({
      modelId: APPLE_ASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'asset_required' }
    })
  })

  it('prefers ready Windows system recognition without requiring a model download', async () => {
    vi.spyOn(windowsTranscriptionDefinition, 'status').mockResolvedValue({ status: 'ready' })
    expect(
      await resolveTranscriptionConfiguration({ language }, undefined, { platform: 'win32', arch: 'x64' })
    ).toMatchObject({
      modelId: WINDOWS_ASR_MODEL_ID,
      language: { source: TranscriptionLanguageSource.Explicit, locale: 'zh-CN' },
      status: { status: 'ready' }
    })
  })

  it('offers a preparation state when no recognizer is ready', async () => {
    vi.spyOn(appleTranscriptionDefinition, 'status').mockResolvedValue({
      status: 'not_installed',
      reason: 'asset_required'
    })
    vi.spyOn(funAsrTranscriptionDefinition, 'status').mockResolvedValue({
      status: 'not_installed',
      reason: 'model_required'
    })
    expect(await resolveTranscriptionConfiguration({ language }, undefined, mac)).toMatchObject({
      modelId: APPLE_ASR_MODEL_ID,
      status: { status: 'not_installed', reason: 'asset_required' }
    })
  })

  it('uses the native language default regardless of voice ID order and preserves an explicit choice', async () => {
    const eddy = { id: 'com.apple.eloquence.zh-CN.Eddy', name: 'Eddy', locale: 'zh-CN' }
    const tingting = { id: 'com.apple.voice.compact.zh-CN.Tingting', name: 'Tingting', locale: 'zh-CN' }
    vi.spyOn(appleSpeechDefinition, 'voices').mockResolvedValue([eddy, tingting])
    vi.spyOn(appleSpeechDefinition, 'getDefaultVoice').mockResolvedValue(tingting)
    vi.spyOn(appleSpeechDefinition, 'status').mockResolvedValue({ status: 'ready' })
    expect(await resolveSpeechConfiguration({ language: 'zh-CN' }, undefined, mac)).toEqual({
      modelId: APPLE_TTS_MODEL_ID,
      language: 'zh-CN',
      voice: tingting.id,
      speed: 1,
      status: { status: 'ready' }
    })
    expect(await resolveSpeechConfiguration({ language: 'zh-CN', voice: eddy.id }, undefined, mac)).toMatchObject({
      voice: eddy.id,
      status: { status: 'ready' }
    })
  })

  it.each([null, { id: 'english', name: 'English', locale: 'en-US' }])(
    'does not substitute a listed voice when the native default is absent or in another language',
    async (voice) => {
      vi.spyOn(appleSpeechDefinition, 'voices').mockResolvedValue([{ id: 'chinese', name: 'Chinese', locale: 'zh-CN' }])
      vi.spyOn(appleSpeechDefinition, 'getDefaultVoice').mockResolvedValue(voice)
      expect(await resolveSpeechConfiguration({ language: 'zh-CN' }, undefined, mac)).toMatchObject({
        status: { status: 'not_installed', reason: 'voice_unavailable' }
      })
    }
  )

  it.each([
    [mac, appleSpeechDefinition, APPLE_TTS_MODEL_ID],
    [{ platform: 'win32', arch: 'x64' }, windowsSpeechDefinition, WINDOWS_TTS_MODEL_ID]
  ])('matches language tags without regard to case on %j', async (environment, definition, modelId) => {
    vi.spyOn(definition, 'voices').mockResolvedValue([{ id: 'english', name: 'English', locale: 'en-US' }])
    vi.spyOn(definition, 'getDefaultVoice').mockResolvedValue({ id: 'english', name: 'English', locale: 'en-US' })
    vi.spyOn(definition, 'status').mockResolvedValue({ status: 'ready' })
    for (const voice of [undefined, 'english']) {
      expect(await resolveSpeechConfiguration({ language: 'en-us', voice }, undefined, environment)).toEqual({
        modelId,
        language: 'en-US',
        voice: 'english',
        speed: 1,
        status: { status: 'ready' }
      })
    }
    expect(
      await resolveSpeechConfiguration({ language: 'en-GB', voice: 'english' }, undefined, environment)
    ).toMatchObject({
      status: { status: 'not_installed', reason: 'voice_unavailable' }
    })
  })

  it('never substitutes an unavailable explicit voice or an unrelated language', async () => {
    vi.spyOn(appleSpeechDefinition, 'getDefaultVoice').mockResolvedValue(null)
    vi.spyOn(appleSpeechDefinition, 'voices').mockResolvedValue([{ id: 'english', name: 'English', locale: 'en-US' }])
    for (const input of [{ voice: 'removed', language: 'en-US' }, { language: 'ja-JP' }]) {
      expect(await resolveSpeechConfiguration(input, undefined, mac)).toMatchObject({
        ...input,
        status: { status: 'not_installed', reason: 'voice_unavailable' }
      })
    }
  })

  it('preserves an explicit voice language when no separate language was saved', async () => {
    vi.spyOn(appleSpeechDefinition, 'voices').mockResolvedValue([{ id: 'chinese', name: 'Chinese', locale: 'zh-CN' }])
    vi.spyOn(appleSpeechDefinition, 'status').mockResolvedValue({ status: 'ready' })
    expect(await resolveSpeechConfiguration({ voice: 'chinese' }, undefined, mac)).toMatchObject({
      voice: 'chinese',
      language: 'zh-CN',
      status: { status: 'ready' }
    })
  })

  it('does not return a default after its inspection was cancelled', async () => {
    const controller = new AbortController()
    vi.spyOn(appleSpeechDefinition, 'getDefaultVoice').mockImplementation(async () => {
      controller.abort()
      return { id: 'chinese', name: 'Chinese', locale: 'zh-CN' }
    })
    await expect(resolveSpeechConfiguration({ language: 'zh-CN' }, controller.signal, mac)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})
