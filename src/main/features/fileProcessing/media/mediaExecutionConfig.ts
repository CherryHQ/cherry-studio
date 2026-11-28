import { createHash } from 'node:crypto'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { resolveSdkConfig } from '@main/ai/provider/sdkConfig'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { describeVoiceModel, resolveTranscriptionConfiguration } from '@main/ai/voice/localAdapters'
import { resolveProcessorConfigByFeature } from '@main/features/fileProcessing/config/resolveProcessorConfig'
import { getAppLanguage } from '@main/i18n'
import {
  isTranscriptionModelId,
  TranscriptionLanguageSource,
  type LocalTranscriptionModelId
} from '@shared/ai/localVoice'
import type { MediaAnalysisProgress } from '@shared/ai/mediaAnalysisProgress'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { parseUniqueModelId, UniqueModelIdSchema, type UniqueModelId } from '@shared/data/types/model'
import { isVideoVisionSelectableModel } from '@shared/utils/model'

import { DEFAULT_MEDIA_FRAME_BUDGET, MEDIA_PIPELINE_VERSION, type MediaFrameBudget } from './types'

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

export interface MediaVisionServing {
  sdkConfig: {
    providerId: keyof AppProviderSettingsMap
    providerSettings: AppProviderSettingsMap[keyof AppProviderSettingsMap]
    modelId: string
  }
  /** Resolve pricing at the start of each vision invocation while preserving request attribution. */
  usage: () => ReturnType<typeof createAiUsageCaptureContext>
}

export interface MediaVisionExecutionConfig {
  uniqueModelId: UniqueModelId
  providerId: string
  modelId: string
  endpointType: string
  baseUrl: string
  /** Resolves the serving credential once, on first use, so cached analyses never advance API-key rotation. */
  resolveServing: () => Promise<MediaVisionServing>
}

export interface MediaAnalysisOptions {
  /** Analyzes frames when no Video Vision model is selected; used only if it is a selectable vision model. */
  fallbackVisionModelId?: UniqueModelId
  onProgress?: (progress: MediaAnalysisProgress) => void
}

export interface MediaExecutionConfig {
  asr: MediaAsrExecutionConfig | null
  ocr: MediaOcrExecutionConfig | null
  vision: MediaVisionExecutionConfig | null
  budget: MediaFrameBudget
  pipelineVersion: typeof MEDIA_PIPELINE_VERSION
}

/** Selects ASR the way dictation does, without installing anything. */
async function resolveAsrExecutionConfig(signal?: AbortSignal): Promise<MediaAsrExecutionConfig | null> {
  const preferences = application.get('PreferenceService')
  const rawModelId = preferences.get('feature.voice.recognition.model_id').trim()
  const explicit = rawModelId ? (isTranscriptionModelId(rawModelId) ? rawModelId : null) : undefined
  if (explicit === null) return null

  const rawLanguage = preferences.get('feature.voice.recognition.language').trim()
  const preferenceLanguage = rawLanguage.toLowerCase() === 'auto' ? '' : rawLanguage
  // A stale language must not void an explicit model that cannot take one.
  const acceptsLanguage = !explicit || describeVoiceModel(explicit).model?.localeSelection != null
  const resolved = await resolveTranscriptionConfiguration(
    {
      ...(explicit && { modelId: explicit }),
      language:
        preferenceLanguage && acceptsLanguage
          ? { source: TranscriptionLanguageSource.Explicit, locale: preferenceLanguage }
          : { source: TranscriptionLanguageSource.Interface, locale: Intl.getCanonicalLocales(getAppLanguage())[0] }
    },
    signal
  )
  if (!resolved.modelId || (!explicit && resolved.status.status !== 'ready')) return null
  return {
    modelId: resolved.modelId,
    ...(resolved.language?.source === TranscriptionLanguageSource.Explicit && { language: resolved.language.locale })
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

function modelExists(uniqueModelId: string): boolean {
  const parsed = UniqueModelIdSchema.safeParse(uniqueModelId)
  if (!parsed.success) return false
  try {
    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    modelService.getByKey(providerId, modelId)
    return true
  } catch {
    return false
  }
}

function resolveVisionExecutionConfig(fallbackModelId: UniqueModelId | undefined): MediaVisionExecutionConfig | null {
  const saved = application.get('PreferenceService').get('feature.file_processing.default_video_vision_model')
  // Settings show a deleted Vision Model as None, so its saved id falls back to the chat model like an unset one.
  const raw = (saved && modelExists(saved) ? saved : null) || fallbackModelId
  if (!raw) return null
  const parsed = UniqueModelIdSchema.safeParse(raw)
  if (!parsed.success) return null

  try {
    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    const model = modelService.getByKey(providerId, modelId)
    const provider = providerService.getByProviderId(providerId)
    if (!isVideoVisionSelectableModel(model, provider)) return null
    const endpoint = resolveEffectiveEndpoint(provider, model)
    const createServing = async (): Promise<MediaVisionServing> => {
      const { sdkConfig, credentialReceipt } = await resolveSdkConfig(provider, model, endpoint)
      const usage = () => {
        let pricingSnapshot: ReturnType<typeof createAiUsageCaptureContext>['pricingSnapshot'] = null
        try {
          const currentProvider = providerService.getByProviderId(provider.id)
          const currentModel = modelService.getByKey(provider.id, modelId)
          pricingSnapshot = createAiUsageCaptureContext({
            providerId: currentProvider.id,
            modelId: sdkConfig.modelId,
            pricing: currentModel.pricing,
            billing: currentProvider.settings.billing,
            billingModelId: modelId
          }).pricingSnapshot
        } catch {
          // Keep the invocation attributable even if the pricing catalog changed mid-analysis.
        }
        return createAiUsageCaptureContext({
          providerId: provider.id,
          providerName: provider.name,
          modelId: sdkConfig.modelId,
          modelName: model.name,
          pricingSnapshot,
          trustProviderReportedCost: provider.reportsActualCost,
          reportedCostCurrency: provider.reportedCostCurrency,
          credentialReceipt
        })
      }
      return {
        sdkConfig: {
          providerId: sdkConfig.providerId,
          providerSettings: sdkConfig.providerSettings,
          modelId: sdkConfig.modelId
        },
        usage
      }
    }

    let serving: Promise<MediaVisionServing> | undefined
    return {
      uniqueModelId: parsed.data,
      providerId,
      modelId,
      endpointType: String(endpoint.endpointType ?? ''),
      baseUrl: endpoint.baseUrl,
      resolveServing: () => (serving ??= createServing())
    }
  } catch {
    return null
  }
}

export async function resolveMediaExecutionConfig(
  options: MediaAnalysisOptions = {},
  signal?: AbortSignal
): Promise<MediaExecutionConfig> {
  return {
    asr: await resolveAsrExecutionConfig(signal),
    ocr: resolveOcrExecutionConfig(),
    vision: resolveVisionExecutionConfig(options.fallbackVisionModelId),
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
