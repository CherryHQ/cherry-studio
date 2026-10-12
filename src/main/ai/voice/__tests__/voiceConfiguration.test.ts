import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  TranscriptionLanguageSource,
  WINDOWS_ASR_MODEL_ID
} from '@shared/ai/localVoice'

import { resolveSpeechConfiguration, resolveTranscriptionConfiguration } from '../localAdapters'
import { appleSpeechDefinition, appleTranscriptionDefinition } from '../localAdapters/apple'
import { funAsrTranscriptionDefinition } from '../localAdapters/funasr'
import { windowsTranscriptionDefinition } from '../localAdapters/windows'

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

  it('recommends a deterministic installed voice in the requested language', async () => {
    vi.spyOn(appleSpeechDefinition, 'voices').mockResolvedValue([
      { id: 'a-english', name: 'English', locale: 'en-US' },
      { id: 'c-chinese', name: 'Chinese 2', locale: 'zh-CN' },
      { id: 'b-chinese', name: 'Chinese 1', locale: 'zh-CN' }
    ])
    vi.spyOn(appleSpeechDefinition, 'status').mockResolvedValue({ status: 'ready' })
    expect(await resolveSpeechConfiguration({ language: 'zh-CN' }, undefined, mac)).toEqual({
      modelId: APPLE_TTS_MODEL_ID,
      language: 'zh-CN',
      voice: 'b-chinese',
      speed: 1,
      status: { status: 'ready' }
    })
  })

  it('never substitutes an unavailable explicit voice or an unrelated language', async () => {
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

  it('does not return a recommendation after its inspection was cancelled', async () => {
    const controller = new AbortController()
    vi.spyOn(appleSpeechDefinition, 'voices').mockImplementation(async () => {
      controller.abort()
      return []
    })
    await expect(resolveSpeechConfiguration({ language: 'zh-CN' }, controller.signal, mac)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})
