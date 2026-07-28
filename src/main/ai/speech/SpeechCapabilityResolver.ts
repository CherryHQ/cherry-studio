import { application } from '@application'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { ResolvedSpeechCapabilities, SpeechModelSelection } from '@shared/ai/speech'
import { type Model, parseUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { isNonChatModel, isSpeechToTextModel, isTextToSpeechModel } from '@shared/utils/model'
import { isExternalCliProvider } from '@shared/utils/provider'

type SpeechModelKind = 'chat' | 'transcription' | 'synthesis'

const preferenceKeys = {
  chat: 'feature.english_learning.model.chat_id',
  transcription: 'feature.english_learning.model.transcription_id',
  synthesis: 'feature.english_learning.model.synthesis_id'
} as const

function supports(kind: SpeechModelKind, model: Model): boolean {
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
  const configured = resolveCandidate(preferences.get(preferenceKeys[kind]), kind)
  if (configured) return configured
  if (kind === 'chat') {
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
    const gaps: ResolvedSpeechCapabilities['gaps'] = ['realtime_unavailable']

    if (!transcription) gaps.push('transcription_unavailable')
    if (!synthesis) gaps.push('synthesis_unavailable')
    if (!chat) gaps.push('chat_unavailable')

    return {
      capabilities: {
        realtime: false,
        transcription: transcription !== null,
        synthesis: synthesis !== null,
        chat: chat !== null
      },
      tier: transcription && chat ? 'composed' : 'text-only',
      models: {
        realtime: null,
        transcription,
        synthesis,
        chat
      },
      gaps
    }
  }
}
