import { createOpenAI } from '@ai-sdk/openai'
import { NoSuchModelError } from '@ai-sdk/provider'

import { getNewApiSpeechEndpoint, getSpeechGenerationEndpoint } from '@cherrystudio/provider-registry'
import { modelService } from '@main/data/services/ModelService'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { providerService } from '@main/data/services/ProviderService'
import { ENDPOINT_TYPE, parseUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { customFetch } from '../utils/customFetch'
import { routeToEndpoint } from '../utils/provider'
import { providerToAiSdkConfig } from './config'
import { createGeminiSpeechModel, geminiSpeechVoices } from './custom/geminiSpeechModel'
import { resolveEffectiveEndpoint, resolveWireModelId } from './endpoint'

const openaiVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']
function speechEndpoint(provider: Provider, model: Model) {
  // These speech adapters require API keys, even when IAM providers share their endpoint protocol.
  if (provider.authType !== 'api-key') return undefined
  if (provider.id === 'new-api' || provider.presetProviderId === 'new-api') {
    const { presetModel } = providerRegistryService.lookupModel(
      provider.id,
      model.apiModelId ?? parseUniqueModelId(model.id).modelId
    )
    const endpointType = getNewApiSpeechEndpoint(model, presetModel)
    return endpointType ? resolveEffectiveEndpoint(provider, { ...model, endpointTypes: [endpointType] }) : undefined
  }
  const endpoint = resolveEffectiveEndpoint(provider, model, ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH)
  return getSpeechGenerationEndpoint({ ...model, endpointTypes: endpoint.endpointType ? [endpoint.endpointType] : [] })
    ? endpoint
    : undefined
}

function resolveCloudModel(id: UniqueModelId) {
  const { providerId, modelId } = parseUniqueModelId(id)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const endpoint = speechEndpoint(provider, model)
  if (!endpoint || !endpoint.baseUrl) throw new NoSuchModelError({ modelId: id, modelType: 'speechModel' })
  return { provider, model, endpoint }
}

export function getProviderSpeechVoices(id: UniqueModelId) {
  const { model, endpoint } = resolveCloudModel(id)
  if (endpoint.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return geminiSpeechVoices
  const wireId = resolveWireModelId(model, endpoint.endpointType)
  return ['tts-1', 'tts-1-hd', 'tts-1-1106', 'tts-1-hd-1106'].includes(wireId)
    ? openaiVoices.filter((voice) =>
        ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].includes(voice)
      )
    : [...openaiVoices, 'marin', 'cedar']
}

export function listProviderSpeechModels(): Model[] {
  return modelService.list({ enabled: true }).flatMap((model) => {
    const provider = providerService.getByProviderId(model.providerId)
    if (!speechEndpoint(provider, model)) return []
    return [{ ...model, name: `${provider.name} · ${model.name}` }]
  })
}

export async function resolveProviderSpeechModel(modelId: UniqueModelId, signal: AbortSignal) {
  const { provider, model, endpoint } = resolveCloudModel(modelId)
  const route = routeToEndpoint(endpoint.baseUrl)
  const config = await providerToAiSdkConfig(provider, model, { resolvedEndpoint: endpoint })
  signal.throwIfAborted()
  const settings = config.providerSettings as {
    baseURL: string
    apiKey: string
    headers?: Record<string, string>
    fetch?: typeof globalThis.fetch
  }
  const wireId = resolveWireModelId(model, endpoint.endpointType)
  const gemini = endpoint.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
  const sdkModel = gemini
    ? createGeminiSpeechModel(wireId, {
        ...settings,
        ...(route.endpoint && { url: `${route.baseURL}:${route.endpoint}` }),
        fetch: settings.fetch ?? customFetch
      })
    : createOpenAI({ ...settings, fetch: settings.fetch ?? customFetch }).speech(wireId)
  return { model: sdkModel, speed: gemini ? ('playback' as const) : ('synthesis' as const) }
}
