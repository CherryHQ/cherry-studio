import { randomUUID } from 'node:crypto'

import type { Usage } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { loggerService } from '@logger'
import { getPiTraceContext } from '@main/ai/observability'
import { isPiCompatibleModel, mapEndpointToPiApi } from '@shared/ai/piModelCompatibility'
import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { resolveAgentContextWindow } from '../agentContextWindow'
import type { AgentRuntimeConnectInput } from '../types'
import { loadPiAi, loadPiApiStreamSimple, loadPiSdk } from './piSdk'

const OBJECT_TRANSPORT_API_KEY = 'cherry-object-transport'

/** Native Pi protocols target Cherry's internal gateway; Cherry retains provider credentials and billing. */
export async function createPiGatewayModelBinding(
  input: Pick<AgentRuntimeConnectInput, 'sessionId' | 'reasoningEffort' | 'serviceTier' | 'fastMode'>,
  provider: Provider,
  model: Model,
  onUsage?: (usage: Usage, nativeSessionId: string | undefined, responseId?: string) => void,
  sharedModels?: ModelRuntime
) {
  if (!isPiCompatibleModel(provider, model)) {
    throw new Error(`Provider "${provider.id}" cannot be routed through the internal gateway for pi agents`)
  }
  const preferredEndpoint =
    model.endpointTypes?.includes(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) &&
    model.endpointTypes.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      : undefined
  const { endpointType } = resolveEffectiveEndpoint(provider, model, preferredEndpoint)
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  const api = mapEndpointToPiApi(endpointType, adapterFamily) ?? 'openai-completions'
  const gateway = application.get('ApiGatewayService')
  const modelId = formatGatewayModelId(provider.id, getRawModelId(model))
  const modalities: ('text' | 'image')[] = ['text']
  if (
    model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION) ||
    model.inputModalities?.includes(MODALITY.IMAGE)
  ) {
    modalities.push('image')
  }
  const [{ InMemoryCredentialStore }, { ModelRuntime }, streamSimple] = await Promise.all([
    loadPiAi(),
    loadPiSdk(),
    loadPiApiStreamSimple(api)
  ])
  const modelRuntime =
    sharedModels ??
    (await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    }))
  // Native provider re-registration replaces its models and stream handler.
  const providerName = sharedModels ? `cherry-gateway/${input.sessionId}/${randomUUID()}` : provider.id
  modelRuntime.registerProvider(providerName, {
    name: provider.name,
    api,
    baseUrl: 'http://cherry-runtime.invalid',
    // Native clients require a key even though object calls use Cherry's trusted execution path.
    apiKey: OBJECT_TRANSPORT_API_KEY,
    models: [
      {
        id: modelId,
        name: model.name,
        reasoning: model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning !== undefined,
        input: modalities,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: resolveAgentContextWindow(model),
        maxTokens: model.maxOutputTokens ?? 8_192,
        // CherryIN can omit the signature delta on thinking blocks that must be replayed.
        ...(provider.id === 'cherryin' && api === 'anthropic-messages' ? { compat: { allowEmptySignature: true } } : {})
      }
    ],
    // Pi's session retry policy owns retries; neither gateway nor HTTP client retries a step.
    streamSimple: (model, context, options) => {
      let releasePayload: (() => void) | undefined
      try {
        // Native reasoning can enlarge per-call output caps before the gateway receives them.
        const stream = streamSimple(model, context, {
          ...options,
          onPayload: async (payload, payloadModel) => {
            releasePayload?.()
            releasePayload = undefined
            const next = await options?.onPayload?.(payload, payloadModel)
            releasePayload = await application
              .get('ApiGatewayService')
              .acquireModelPayloadBudget(next === undefined ? payload : next, options?.signal)
            return next
          },
          objectTransports: gateway.createAgentObjectTransports({
            ...input,
            headers: options?.headers,
            traceContext: getPiTraceContext(options?.telemetry)
          }),
          disableContinuation: true,
          reasoning: undefined,
          maxRetries: 0
        })
        void stream
          .result()
          .then((message) => {
            if (!options?.readOnlyFork) onUsage?.(message.usage, options?.sessionId, message.responseId)
          })
          .catch((error) => {
            loggerService
              .withContext('PiGatewayModelBinding')
              .error('Failed to observe native model response', { error })
          })
          .finally(() => {
            releasePayload?.()
          })
        return stream
      } catch (error) {
        releasePayload?.()
        throw error
      }
    }
  })
  await modelRuntime.setRuntimeApiKey(providerName, OBJECT_TRANSPORT_API_KEY)
  const registered = modelRuntime.getModel(providerName, modelId)
  if (!registered) throw new Error(`Pi gateway model ${modelId} was not registered`)
  return { modelRuntime, model: registered }
}
