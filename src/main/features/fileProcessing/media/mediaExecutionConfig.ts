import { createHash } from 'node:crypto'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { resolveSdkConfig } from '@main/ai/provider/sdkConfig'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { resolveDefaultAsrModel } from '@main/ai/voice/voicePlatform'
import { resolveProcessorConfigByFeature } from '@main/features/fileProcessing/config/resolveProcessorConfig'
import { APPLE_ASR_MODEL_ID, FUNASR_MODEL_ID, type LocalTranscriptionModelId } from '@shared/ai/localVoice'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { parseUniqueModelId, UniqueModelIdSchema, type UniqueModelId } from '@shared/data/types/model'
import { DEFAULT_MEDIA_FRAME_BUDGET, MEDIA_PIPELINE_VERSION, type MediaFrameBudget } from '@shared/types/mediaAnalysis'
import { isVideoVisionSelectableModel } from '@shared/utils/model'

export interface MediaAsrExecutionConfig {
  modelId: LocalTranscriptionModelId
  language?: string
}

export interface MediaOcrExecutionConfig {
  processor: FileProcessorMerged
  identity: {
    processorId: string
    modelId: string
    apiHost: string
    optionsJson: string
  }
}

export interface MediaVisionExecutionConfig {
  uniqueModelId: UniqueModelId
  providerId: string
  modelId: string
  endpointType: string
  baseUrl: string
  sdkConfig: {
    providerId: keyof AppProviderSettingsMap
    providerSettings: AppProviderSettingsMap[keyof AppProviderSettingsMap]
    modelId: string
  }
}

export interface MediaExecutionConfig {
  asr: MediaAsrExecutionConfig | null
  ocr: MediaOcrExecutionConfig | null
  vision: MediaVisionExecutionConfig | null
  budget: MediaFrameBudget
  pipelineVersion: typeof MEDIA_PIPELINE_VERSION
}

export class MediaAnalysisConfigError extends Error {
  constructor(readonly code: 'unsupported_asr_model' | 'invalid_vision_model') {
    super(code)
    this.name = 'MediaAnalysisConfigError'
  }
}

function resolveAsrExecutionConfig(): MediaAsrExecutionConfig | null {
  const preferences = application.get('PreferenceService')
  const rawModelId = preferences.get('feature.voice.recognition.model_id').trim()
  const explicit = rawModelId
    ? rawModelId === APPLE_ASR_MODEL_ID || rawModelId === FUNASR_MODEL_ID
      ? rawModelId
      : null
    : undefined
  if (explicit === null) throw new MediaAnalysisConfigError('unsupported_asr_model')

  const modelId = resolveDefaultAsrModel(
    {
      platform: process.platform,
      majorVersion: process.platform === 'darwin' ? Number.parseInt(process.getSystemVersion(), 10) : undefined
    },
    explicit
  )
  if (!modelId) return null

  const language = preferences.get('feature.voice.recognition.language').trim()
  return {
    modelId,
    ...(language && modelId !== FUNASR_MODEL_ID ? { language } : {})
  }
}

function resolveOcrExecutionConfig(): MediaOcrExecutionConfig | null {
  try {
    const processor = resolveProcessorConfigByFeature('image_to_text')
    const capability = processor.capabilities.find((item) => item.feature === 'image_to_text')
    return {
      processor,
      identity: {
        processorId: processor.id,
        modelId: capability?.modelId ?? '',
        apiHost: capability?.apiHost ?? '',
        optionsJson: JSON.stringify(processor.options ?? {})
      }
    }
  } catch {
    return null
  }
}

async function resolveVisionExecutionConfig(): Promise<MediaVisionExecutionConfig | null> {
  const raw = application.get('PreferenceService').get('feature.file_processing.default_video_vision_model')
  if (!raw) return null
  const parsed = UniqueModelIdSchema.safeParse(raw)
  if (!parsed.success) throw new MediaAnalysisConfigError('invalid_vision_model')

  try {
    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    const model = modelService.getByKey(providerId, modelId)
    const provider = providerService.getByProviderId(providerId)
    if (!isVideoVisionSelectableModel(model, provider)) throw new MediaAnalysisConfigError('invalid_vision_model')
    const endpoint = resolveEffectiveEndpoint(provider, model)
    const { sdkConfig } = await resolveSdkConfig(provider, model, endpoint)
    return {
      uniqueModelId: parsed.data,
      providerId,
      modelId,
      endpointType: String(endpoint.endpointType ?? ''),
      baseUrl: endpoint.baseUrl,
      sdkConfig: {
        providerId: sdkConfig.providerId,
        providerSettings: sdkConfig.providerSettings,
        modelId: sdkConfig.modelId
      }
    }
  } catch (error) {
    if (error instanceof MediaAnalysisConfigError) throw error
    throw new MediaAnalysisConfigError('invalid_vision_model')
  }
}

export async function resolveMediaExecutionConfig(): Promise<MediaExecutionConfig> {
  return {
    asr: resolveAsrExecutionConfig(),
    ocr: resolveOcrExecutionConfig(),
    vision: await resolveVisionExecutionConfig(),
    budget: { ...DEFAULT_MEDIA_FRAME_BUDGET },
    pipelineVersion: MEDIA_PIPELINE_VERSION
  }
}

export function hashMediaExecutionConfig(config: MediaExecutionConfig): string {
  const identity = {
    asr: config.asr,
    ocr: config.ocr?.identity ?? null,
    vision: config.vision
      ? {
          uniqueModelId: config.vision.uniqueModelId,
          providerId: config.vision.providerId,
          modelId: config.vision.modelId,
          endpointType: config.vision.endpointType,
          baseUrl: config.vision.baseUrl
        }
      : null,
    budget: config.budget,
    pipelineVersion: config.pipelineVersion
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)
}
