import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ASR_MODEL_ID, FUNASR_MODEL_ID, WINDOWS_ASR_MODEL_ID } from '@shared/ai/localVoice'
import { MEDIA_PIPELINE_VERSION } from '@shared/types/mediaAnalysis'

const state = vi.hoisted(() => ({
  preferences: new Map<string, unknown>(),
  resolveProcessor: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name !== 'PreferenceService') throw new Error(`Unexpected service: ${name}`)
      return { get: (key: string) => state.preferences.get(key) }
    }
  }
}))

vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: vi.fn() } }))
vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId: vi.fn() } }))
vi.mock('@main/features/fileProcessing/config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: state.resolveProcessor
}))

import { modelService } from '@data/services/ModelService'

import {
  hashMediaExecutionConfig,
  resolveMediaExecutionConfig,
  type MediaExecutionConfig
} from '../mediaExecutionConfig'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')
const originalSystemVersion = Object.getOwnPropertyDescriptor(process, 'getSystemVersion')

beforeEach(() => {
  state.preferences.clear()
  state.preferences.set('feature.file_processing.default_video_vision_model', null)
  state.preferences.set('feature.voice.recognition.model_id', '')
  state.preferences.set('feature.voice.recognition.language', '')
  state.resolveProcessor.mockReset().mockImplementation(() => {
    throw new Error('no OCR configured')
  })
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  Object.defineProperty(process, 'getSystemVersion', { configurable: true, value: () => '26.0.0' })
  if (originalArch) Object.defineProperty(process, 'arch', originalArch)
})

describe('resolveMediaExecutionConfig', () => {
  it('uses the platform default ASR without writing a temporary preference', async () => {
    const config = await resolveMediaExecutionConfig()
    expect(config.asr).toEqual({ modelId: APPLE_ASR_MODEL_ID })
    expect(state.preferences.get('feature.voice.recognition.model_id')).toBe('')
  })

  it('forwards language to Apple ASR and omits it for FunASR', async () => {
    state.preferences.set('feature.voice.recognition.model_id', APPLE_ASR_MODEL_ID)
    state.preferences.set('feature.voice.recognition.language', 'zh-CN')
    await expect(resolveMediaExecutionConfig()).resolves.toMatchObject({
      asr: { modelId: APPLE_ASR_MODEL_ID, language: 'zh-CN' }
    })

    state.preferences.set('feature.voice.recognition.model_id', FUNASR_MODEL_ID)
    await expect(resolveMediaExecutionConfig()).resolves.toMatchObject({ asr: { modelId: FUNASR_MODEL_ID } })
  })

  it('forwards language to an explicit Windows ASR model', async () => {
    state.preferences.set('feature.voice.recognition.model_id', WINDOWS_ASR_MODEL_ID)
    state.preferences.set('feature.voice.recognition.language', 'zh-CN')
    expect((await resolveMediaExecutionConfig()).asr).toEqual({
      modelId: WINDOWS_ASR_MODEL_ID,
      language: 'zh-CN'
    })
  })

  it('uses the Windows x64 and Linux x64 platform defaults', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    Object.defineProperty(process, 'arch', { configurable: true, value: 'x64' })
    expect((await resolveMediaExecutionConfig()).asr).toEqual({ modelId: WINDOWS_ASR_MODEL_ID })

    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    expect((await resolveMediaExecutionConfig()).asr).toEqual({ modelId: FUNASR_MODEL_ID })
  })

  it('returns no ASR for an unknown explicit id and still resolves OCR', async () => {
    state.preferences.set('feature.voice.recognition.model_id', 'provider::whisper')
    state.resolveProcessor.mockReturnValue({
      id: 'system-ocr',
      capabilities: [{ feature: 'image_to_text', modelId: 'ocr-model', apiHost: 'https://ocr.example' }],
      options: { lang: 'en' }
    })

    const config = await resolveMediaExecutionConfig()

    expect(config.asr).toBeNull()
    expect(config.ocr?.identity).toEqual({
      processorId: 'system-ocr',
      modelId: 'ocr-model',
      apiHost: 'https://ocr.example',
      optionsJson: '{"lang":"en"}'
    })
    expect(config.vision).toBeNull()
  })

  it('keeps ASR when a selected video vision model has been deleted', async () => {
    state.preferences.set('feature.file_processing.default_video_vision_model', 'openai::gpt-4o')
    vi.mocked(modelService.getByKey).mockImplementation(() => {
      throw new Error('Model not found')
    })

    const config = await resolveMediaExecutionConfig()

    expect(config.vision).toBeNull()
    expect(config.asr).toEqual({ modelId: APPLE_ASR_MODEL_ID })
  })
})

describe('hashMediaExecutionConfig', () => {
  it('changes for execution identities but excludes SDK credentials', () => {
    const config: MediaExecutionConfig = {
      asr: { modelId: APPLE_ASR_MODEL_ID, language: 'en-US' },
      ocr: null,
      vision: {
        uniqueModelId: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        endpointType: 'openai-chat-completions',
        baseUrl: 'https://api.openai.com/v1',
        sdkConfig: { providerId: 'openai-chat', providerSettings: { apiKey: 'secret-a' }, modelId: 'gpt-4o' }
      },
      budget: { maxFrames: 24, targetIntervalMs: 4_000, maxEdgePx: 1280, jpegQuality: 75 },
      pipelineVersion: MEDIA_PIPELINE_VERSION
    }
    const withAnotherSecret: MediaExecutionConfig = {
      ...config,
      vision: {
        ...config.vision!,
        sdkConfig: { ...config.vision!.sdkConfig, providerSettings: { apiKey: 'secret-b' } }
      }
    }
    expect(hashMediaExecutionConfig(config)).toBe(hashMediaExecutionConfig(withAnotherSecret))
    expect(hashMediaExecutionConfig(config)).not.toBe(
      hashMediaExecutionConfig({ ...config, asr: { ...config.asr!, language: 'ja-JP' } })
    )
    expect(MEDIA_PIPELINE_VERSION).toBe(2)
    expect(hashMediaExecutionConfig(config)).not.toBe(
      hashMediaExecutionConfig({ ...config, pipelineVersion: 1 as MediaExecutionConfig['pipelineVersion'] })
    )
  })
})

afterAll(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  if (originalArch) Object.defineProperty(process, 'arch', originalArch)
  if (originalSystemVersion) Object.defineProperty(process, 'getSystemVersion', originalSystemVersion)
  else delete (process as { getSystemVersion?: () => string }).getSystemVersion
})
