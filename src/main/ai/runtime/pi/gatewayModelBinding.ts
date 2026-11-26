import { randomUUID } from 'node:crypto'

import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { loggerService } from '@logger'
import { getPiTraceContext } from '@main/ai/observability'
import { resolveGatewayModelAddress } from '@main/features/apiGateway/utils/models'
import { isPiCompatibleModel, mapEndpointToPiApi } from '@shared/ai/piModelCompatibility'
import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { RetryPartData } from '@shared/data/types/uiParts'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { needsPlainToolReasoning, ToolContinuationRouteError } from '../../provider/replayRoute'
import { resolveReplayRouteId } from '../../provider/sdkConfig'
import { resolveAgentContextWindow } from '../agentContextWindow'
import type { AgentRuntimeConnectInput } from '../types'
import { loadPiAi, loadPiApiStreamSimple, loadPiSdk } from './piSdk'
import {
  getForeignPiToolOrdinals,
  getPendingPiReplayMessage,
  preparePiReplay,
  type ReplayAssistantMessage
} from './replayHistory'

const OBJECT_TRANSPORT_API_KEY = 'cherry-object-transport'

/** Native Pi protocols target Cherry's internal gateway; Cherry retains provider credentials and billing. */
export async function createPiGatewayModelBinding(
  input: Pick<AgentRuntimeConnectInput, 'sessionId' | 'reasoningEffort' | 'serviceTier' | 'fastMode'>,
  provider: Provider,
  model: Model,
  onUsage?: (usage: Usage, nativeSessionId: string | undefined, responseId?: string) => void,
  sharedModels?: ModelRuntime,
  onRetry?: (event: RetryPartData, nativeSessionId: string) => void,
  nativeProviders?: readonly [string, ...string[]]
): Promise<{
  modelRuntime: ModelRuntime
  model: NonNullable<ReturnType<ModelRuntime['getModel']>>
  onRetry?: typeof onRetry
}> {
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
  const [{ InMemoryCredentialStore, createAssistantMessageEventStream }, { ModelRuntime }, streamSimple] =
    await Promise.all([loadPiAi(), loadPiSdk(), loadPiApiStreamSimple(api)])
  const modelRuntime =
    sharedModels ??
    (await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    }))
  // Native provider re-registration replaces its models and stream handler.
  const providerName =
    nativeProviders?.[0] ?? (sharedModels ? `cherry-gateway/${input.sessionId}/${randomUUID()}` : provider.id)
  const registration: Parameters<ModelRuntime['registerProvider']>[1] = {
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
    streamSimple: (model, context, options) => {
      const output = createAssistantMessageEventStream()
      void (async () => {
        try {
          options?.signal?.throwIfAborted()
          const pending = getPendingPiReplayMessage(context)
          if (pending && pending.model !== model.id) {
            const origin = await resolveGatewayModelAddress(pending.model, true).catch(() => {
              throw new ToolContinuationRouteError()
            })
            const binding = await createPiGatewayModelBinding(
              input,
              origin.provider,
              origin.model,
              undefined,
              modelRuntime,
              onRetry
            )
            const stream = binding.modelRuntime.streamSimple(binding.model, context, options)
            for await (const event of stream) output.push(event)
            output.end(await stream.result())
            return
          }
          const current = await resolveGatewayModelAddress(model.id, true)
          const endpoint = resolveEffectiveEndpoint(current.provider, current.model, preferredEndpoint)
          const routeId = await resolveReplayRouteId(current.provider, current.model, endpoint)
          if (pending && pending.cherryReplayRouteId !== routeId) throw new ToolContinuationRouteError()
          options?.signal?.throwIfAborted()
          const stream = streamSimple(model, preparePiReplay(context, model, routeId), {
            ...options,
            objectTransports: gateway.createAgentObjectTransports({
              ...input,
              replayRouteId: routeId,
              ...(model.api === 'google-generative-ai' && {
                omitGeminiSignaturesFor: getForeignPiToolOrdinals(context, routeId)
              }),
              headers: options?.headers,
              traceContext: getPiTraceContext(options?.telemetry),
              onRetryEvent: (event) => {
                if (options?.sessionId && !options.readOnlyFork) onRetry?.(event, options.sessionId)
              }
            }),
            disableContinuation: true,
            reasoning: undefined,
            maxRetries: 0
          })
          for await (const event of stream) {
            if (event.type === 'done') {
              const message = event.message as ReplayAssistantMessage
              message.cherryReplayRouteId = routeId
              if (needsPlainToolReasoning(endpoint.endpointType, current.model))
                message.cherryRequiresToolReasoning = true
            }
            output.push(event)
          }
          output.end(await stream.result())
        } catch (cause) {
          const reason = options?.signal?.aborted ? 'aborted' : 'error'
          const error: AssistantMessage = {
            role: 'assistant',
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
            timestamp: Date.now(),
            stopReason: reason,
            errorMessage: cause instanceof Error ? cause.message : String(cause)
          }
          output.push({ type: 'error', reason, error })
          output.end(error)
        }
      })()
      void output
        .result()
        .then((message) => {
          if (!options?.readOnlyFork) onUsage?.(message.usage, options?.sessionId, message.responseId)
        })
        .catch((error) => {
          loggerService.withContext('PiGatewayModelBinding').error('Failed to observe native model response', { error })
        })
      return output
    }
  }
  for (const name of new Set(nativeProviders ?? [providerName])) {
    modelRuntime.registerProvider(name, registration)
    await modelRuntime.setRuntimeApiKey(name, OBJECT_TRANSPORT_API_KEY)
  }
  const registered = modelRuntime.getModel(providerName, modelId)
  if (!registered) throw new Error(`Pi gateway model ${modelId} was not registered`)
  return { modelRuntime, model: registered, ...(onRetry && { onRetry }) }
}
