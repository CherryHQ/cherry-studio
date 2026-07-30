import { application } from '@application'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { ResolvedSpeechCapabilities, SpeechModelSelection } from '@shared/ai/speech'
import { type Model, parseUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { isAudioModel, isNonChatModel, isSpeechToTextModel, isTextToSpeechModel } from '@shared/utils/model'
import { isExternalCliProvider } from '@shared/utils/provider'

type SpeechModelKind = 'audioEvaluation' | 'chat' | 'realtime' | 'transcription' | 'synthesis'

const preferenceKeys = {
  chat: 'feature.english_learning.model.chat_id',
  pronunciation: 'feature.english_learning.model.pronunciation_id',
  realtime: 'feature.english_learning.model.realtime_id',
  transcription: 'feature.english_learning.model.transcription_id',
  synthesis: 'feature.english_learning.model.synthesis_id'
} as const

const REALTIME_MODEL_PATTERN = /(?:^|[/:._-])gpt[-_]?realtime(?:$|[/:._-])/i

function supports(kind: SpeechModelKind, model: Model): boolean {
  if (kind === 'audioEvaluation') return !isNonChatModel(model) && isAudioModel(model)
  if (kind === 'realtime') {
    return REALTIME_MODEL_PATTERN.test(model.apiModelId ?? model.id) || REALTIME_MODEL_PATTERN.test(model.name)
  }
  if (kind === 'transcription') return isSpeechToTextModel(model)
  if (kind === 'synthesis') return isTextToSpeechModel(model)
  return !isNonChatModel(model)
}

function toSelection(model: Model): SpeechModelSelection {
  const { modelId } = parseUniqueModelId(model.id)
  return {
    uniqueModelId: model.id,
    providerId: model.providerId,
    modelId,
    name: model.name
  }
}

function resolveCandidate(uniqueModelId: unknown, kind: SpeechModelKind): SpeechModelSelection | null {
  const parsed = UniqueModelIdSchema.safeParse(uniqueModelId)
  if (!parsed.success) return null

  try {
    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
    if (!provider.isEnabled || isExternalCliProvider(provider) || !model.isEnabled || !supports(kind, model))
      return null
    return toSelection(model)
  } catch {
    return null
  }
}

function resolveAny(kind: SpeechModelKind): SpeechModelSelection | null {
  for (const model of modelService.list({ enabled: true })) {
    if (!supports(kind, model)) continue
    try {
      const provider = providerService.getByProviderId(model.providerId)
      if (provider.isEnabled && !isExternalCliProvider(provider)) return toSelection(model)
    } catch {
      // A model can outlive its provider briefly during reconciliation.
    }
  }
  return null
}

function resolveKind(kind: SpeechModelKind): SpeechModelSelection | null {
  const preferences = application.get('PreferenceService')
  if (kind !== 'audioEvaluation') {
    const configured = resolveCandidate(preferences.get(preferenceKeys[kind]), kind)
    if (configured) return configured
  }
  if (kind === 'audioEvaluation') {
    const configuredPronunciation = resolveCandidate(preferences.get(preferenceKeys.pronunciation), kind)
    if (configuredPronunciation) return configuredPronunciation

    const configuredChat = resolveCandidate(preferences.get(preferenceKeys.chat), kind)
    if (configuredChat) return configuredChat
  }
  if (kind === 'chat' || kind === 'audioEvaluation') {
    const defaultChat = resolveCandidate(preferences.get('chat.default_model_id'), kind)
    if (defaultChat) return defaultChat
  }
  return resolveAny(kind)
}

export class SpeechCapabilityResolver {
  resolve(): ResolvedSpeechCapabilities {
    const transcription = resolveKind('transcription')
    const synthesis = resolveKind('synthesis')
    const chat = resolveKind('chat')
    const realtime = resolveKind('realtime')
    const audioEvaluation = resolveKind('audioEvaluation')
    const gaps: ResolvedSpeechCapabilities['gaps'] = []

    if (!realtime) gaps.push('realtime_unavailable')
    if (!transcription) gaps.push('transcription_unavailable')
    if (!synthesis) gaps.push('synthesis_unavailable')
    if (!chat) gaps.push('chat_unavailable')
    if (!audioEvaluation) gaps.push('audio_evaluation_unavailable')

    return {
      capabilities: {
        realtime: realtime !== null,
        transcription: transcription !== null,
        synthesis: synthesis !== null,
        chat: chat !== null,
        audioEvaluation: audioEvaluation !== null
      },
      tier: realtime ? 'realtime' : transcription && chat ? 'composed' : 'text-only',
      models: {
        realtime,
        transcription,
        synthesis,
        chat,
        audioEvaluation
      },
      gaps
    }
  }
}
