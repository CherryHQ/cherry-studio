/**
 * Immutable execution configuration for one media-analysis request.
 * Resolved once, used for both cache identity and actual ASR/OCR/vision calls.
 */

import { createHash } from 'node:crypto'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { resolveSdkConfig } from '@main/ai/provider/sdkConfig'
import type { AppProviderId, AppProviderSettingsMap } from '@main/ai/types'
import { resolveProcessorConfigByFeature } from '@main/features/fileProcessing/config/resolveProcessorConfig'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { parseUniqueModelId, UniqueModelIdSchema, type UniqueModelId } from '@shared/data/types/model'
import { DEFAULT_MEDIA_FRAME_BUDGET, MEDIA_PIPELINE_VERSION, type MediaFrameBudget } from '@shared/types/mediaAnalysis'
import { isVideoVisionSelectableModel } from '@shared/utils/nativeFileSupport'

export type MediaAsrExecutionConfig = {
  processor: FileProcessorMerged
  modelId: string
  apiHost: string
  optionsJson: string
}

export type MediaOcrExecutionConfig = {
  processor: FileProcessorMerged
  modelId: string
  apiHost: string
  optionsJson: string
}

export type MediaVisionExecutionConfig = {
  uniqueModelId: UniqueModelId
  providerId: string
  modelId: string
  endpointType: string
  aiSdkProviderId: AppProviderId
  baseUrl: string
  /** Frozen SDK settings for generateText — not included in cache hash. */
  sdkConfig: {
    providerId: keyof AppProviderSettingsMap
    providerSettings: AppProviderSettingsMap[keyof AppProviderSettingsMap]
    modelId: string
  }
}

export type MediaExecutionConfig = {
  asr: MediaAsrExecutionConfig | null
  ocr: MediaOcrExecutionConfig | null
  vision: MediaVisionExecutionConfig | null
  budget: MediaFrameBudget
  pipelineVersion: typeof MEDIA_PIPELINE_VERSION
}

function capabilityFields(
  processor: FileProcessorMerged,
  feature: 'audio_to_text' | 'image_to_text'
): { modelId: string; apiHost: string; optionsJson: string } {
  const capability = processor.capabilities.find((item) => item.feature === feature)
  return {
    modelId: capability?.modelId ?? '',
    apiHost: capability?.apiHost ?? '',
    optionsJson: JSON.stringify(processor.options ?? {})
  }
}

function tryResolveProcessor(feature: 'audio_to_text' | 'image_to_text'): FileProcessorMerged | null {
  try {
    return resolveProcessorConfigByFeature(feature)
  } catch {
    return null
  }
}

async function resolveVisionExecutionConfig(): Promise<MediaVisionExecutionConfig | null> {
  const raw = application.get('PreferenceService').get('feature.file_processing.default_video_vision_model')
  if (typeof raw !== 'string' || !raw.trim()) return null
  const parsed = UniqueModelIdSchema.safeParse(raw.trim())
  if (!parsed.success) return null

  try {
    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    const model = modelService.getByKey(providerId, modelId)
    const provider = providerService.getByProviderId(providerId)
    // Same gate as the video-vision picker: vision chat model + not force-text.
    if (!isVideoVisionSelectableModel(model, provider)) return null
    const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
    const { sdkConfig } = await resolveSdkConfig(provider, model, resolvedEndpoint)

    return {
      uniqueModelId: parsed.data,
      providerId,
      modelId,
      endpointType: String(resolvedEndpoint.endpointType ?? ''),
      aiSdkProviderId: sdkConfig.providerId as AppProviderId,
      baseUrl: resolvedEndpoint.baseUrl ?? '',
      sdkConfig: {
        providerId: sdkConfig.providerId,
        providerSettings: sdkConfig.providerSettings,
        modelId: sdkConfig.modelId
      }
    }
  } catch {
    return null
  }
}

/** Resolve the immutable config for one analysis. Call once per request. */
export async function resolveMediaExecutionConfig(): Promise<MediaExecutionConfig> {
  const asrProcessor = tryResolveProcessor('audio_to_text')
  const ocrProcessor = tryResolveProcessor('image_to_text')
  const vision = await resolveVisionExecutionConfig()
  return {
    asr: asrProcessor ? { processor: asrProcessor, ...capabilityFields(asrProcessor, 'audio_to_text') } : null,
    ocr: ocrProcessor ? { processor: ocrProcessor, ...capabilityFields(ocrProcessor, 'image_to_text') } : null,
    vision,
    budget: { ...DEFAULT_MEDIA_FRAME_BUDGET },
    pipelineVersion: MEDIA_PIPELINE_VERSION
  }
}

/** Stable hash for cache identity — excludes secrets (apiKeys / sdk settings). */
export function hashMediaExecutionConfig(config: MediaExecutionConfig): string {
  const identity = {
    asr: config.asr
      ? {
          id: config.asr.processor.id,
          modelId: config.asr.modelId,
          apiHost: config.asr.apiHost,
          optionsJson: config.asr.optionsJson
        }
      : null,
    ocr: config.ocr
      ? {
          id: config.ocr.processor.id,
          modelId: config.ocr.modelId,
          apiHost: config.ocr.apiHost,
          optionsJson: config.ocr.optionsJson
        }
      : null,
    vision: config.vision
      ? {
          uniqueModelId: config.vision.uniqueModelId,
          providerId: config.vision.providerId,
          modelId: config.vision.modelId,
          endpointType: config.vision.endpointType,
          aiSdkProviderId: config.vision.aiSdkProviderId,
          baseUrl: config.vision.baseUrl
        }
      : null,
    budget: config.budget,
    pipelineVersion: config.pipelineVersion
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)
}
