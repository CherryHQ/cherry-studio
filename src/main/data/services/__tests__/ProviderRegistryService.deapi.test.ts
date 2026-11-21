import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
// Registers ProviderService, which model resolution reads the provider context from.
import '@data/services/ProviderService'
import { isEmbeddingModel, isNonChatModel } from '@shared/utils/model'

// The ids deAPI's `GET /v1/models` returns: bare native ids with no type information.
const IMAGE_IDS = [
  'ZImageTurbo_INT8',
  'Flux_2_Klein_4B_BF16',
  'Flux1schnell',
  'ZAnimeDistill_8Step_INT8',
  'QwenImageEdit_Plus_NF4'
]
const SPEECH_IDS = ['Kokoro', 'Chatterbox', 'Qwen3_TTS_12Hz_1_7B_CustomVoice', 'Qwen3_TTS_12Hz_1_7B_VoiceDesign']
const TRANSCRIPTION_IDS = ['WhisperLargeV3Ct2', 'WhisperLargeV3']
const VIDEO_IDS = [
  'Ltx2_5_22B_Dist_INT8',
  'MiniMaxH3_33B_Turbo_INT8',
  'Ltx2_3_22B_Dist_INT8',
  'Ltxv_13B_0_9_8_Distilled_FP8'
]
const GATEWAY_IDS = [...IMAGE_IDS, 'Bge_M3_FP16', ...SPEECH_IDS, ...TRANSCRIPTION_IDS, ...VIDEO_IDS]

describe('ProviderRegistryService deAPI media-only catalog', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : key === 'app.root'
          ? resolve(process.cwd(), filename ?? '')
          : (getPath?.(key, filename) ?? `/mock/${key}`)
    )
    providerRegistryService.clearCache()
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'deapi', presetProviderId: 'deapi', name: 'deAPI', orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  // deAPI has no chat endpoint: a listed id that falls through as a chat model would fail on first use.
  it('never offers a gateway model as a chat model', () => {
    const models = providerRegistryService.resolveModels('deapi', GATEWAY_IDS)
    expect(models.map((model) => model.apiModelId)).toEqual(GATEWAY_IDS)
    for (const model of models) {
      expect(isNonChatModel(model), model.apiModelId).toBe(true)
    }
  })

  it('routes image models to the painting endpoints with the sizes the gateway accepts', () => {
    const models = providerRegistryService.resolveModels('deapi', IMAGE_IDS)
    for (const model of models) {
      expect(model.capabilities, model.apiModelId).toContain('image-generation')
    }
    expect(
      providerRegistryService.getImageGenerationSupport('deapi', 'Flux1schnell')?.modes.generate?.supports.size
    ).toMatchObject({ options: ['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'] })
    // The gateway caps Klein at n=2 for both generation and edits.
    const klein = providerRegistryService.getImageGenerationSupport('deapi', 'Flux_2_Klein_4B_BF16')
    expect(klein?.modes.generate?.supports.numImages).toMatchObject({ max: 2 })
    expect(klein?.modes.edit).toMatchObject({ maxInputImages: 3, supports: { numImages: { max: 2 } } })
    const qwenEdit = providerRegistryService.getImageGenerationSupport('deapi', 'QwenImageEdit_Plus_NF4')
    expect(Object.keys(qwenEdit?.modes ?? {})).toEqual(['edit'])
    expect(qwenEdit?.modes.edit?.maxInputImages).toBe(1)
  })

  it('offers BGE-M3 as an embedding model for knowledge bases', () => {
    const [model] = providerRegistryService.resolveModels('deapi', ['Bge_M3_FP16'])
    expect(isEmbeddingModel(model)).toBe(true)
    expect(model.endpointTypes).toEqual(['openai-embeddings'])
  })
})
