import type { Usage } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'

import { loggerService } from '@logger'
import { CHERRY_FAST_MODE_HEADER, CHERRY_REASONING_EFFORT_HEADER, CHERRY_SERVICE_TIER_HEADER } from '@main/ai/constants'
import { startAgentRuntimeChildSpan, endAgentRuntimeSpan } from '@main/ai/observability'
import { isPiCompatibleModel, mapEndpointToPiApi, type PiApi } from '@shared/ai/piModelCompatibility'
import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { resolveApiGatewayRuntime } from '../agentApiGateway'
import { resolveAgentContextWindow } from '../agentContextWindow'
import type { AgentRuntimeConnectInput } from '../types'
import { formatPiOutputLimitDiagnostic } from './outputLimitDiagnostic'
import { loadPiAi, loadPiApiStreamSimple, loadPiSdk } from './piSdk'
import { reportedOutputUsageObserver, type ReportedOutputUsage } from './reportedOutputUsage'

/** Native Pi protocols target Cherry's internal gateway; Cherry retains provider credentials and billing. */
export async function createPiGatewayModelBinding(
  input: Pick<AgentRuntimeConnectInput, 'sessionId' | 'reasoningEffort' | 'serviceTier' | 'fastMode' | 'trace'>,
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
  const gateway = await resolveApiGatewayRuntime(input.sessionId)
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
  const providerName = sharedModels ? `cherry-gateway/${model.id}` : provider.id
  modelRuntime.registerProvider(providerName, {
    name: provider.name,
    api,
    baseUrl: formatPiBaseUrl(gateway.baseUrl, api),
    // Pi interpolates configured keys; supply the gateway key through runtime credentials instead.
    apiKey: 'cherry-managed-runtime-key',
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
    headers: {
      ...gateway.usageHeaders,
      [CHERRY_REASONING_EFFORT_HEADER]: input.reasoningEffort ?? 'default',
      ...(input.serviceTier ? { [CHERRY_SERVICE_TIER_HEADER]: input.serviceTier } : {}),
      [CHERRY_FAST_MODE_HEADER]: String(input.fastMode === true)
    },
    // Pi's session retry policy owns retries; neither gateway nor HTTP client retries a step.
    streamSimple: (model, context, options) => {
      const span = startAgentRuntimeChildSpan(input.trace, 'pi.generate_content', SpanKind.CLIENT, {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': provider.id,
        'gen_ai.request.model': model.id
      })
      // Native reasoning can enlarge per-call output caps before the gateway receives them.
      const reported: ReportedOutputUsage = {}
      const stream = streamSimple(model, context, {
        ...options,
        reasoning: undefined,
        maxRetries: 0,
        onProviderStreamEvent: reportedOutputUsageObserver(reported, options?.onProviderStreamEvent)
      })
      void stream
        .result()
        .then((message) => {
          // The pinned SDK resolves result() before delivering its terminal event.
          // Decorate that same message before native input_settled projects its error.
          if (message.stopReason === 'length') {
            message.errorMessage = formatPiOutputLimitDiagnostic({ configuredMaxTokens: model.maxTokens, ...reported })
          }
          onUsage?.(message.usage, options?.sessionId, message.responseId)
          const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
          if (span) {
            span.setAttribute(
              'gen_ai.usage.input_tokens',
              message.usage.input + message.usage.cacheRead + message.usage.cacheWrite
            )
            span.setAttribute('gen_ai.usage.output_tokens', message.usage.output)
            endAgentRuntimeSpan(span, {
              code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK,
              message: message.errorMessage
            })
          }
        })
        .catch((error) => {
          if (span) endAgentRuntimeSpan(span, { code: SpanStatusCode.ERROR, message: String(error) })
          loggerService.withContext('PiGatewayModelBinding').error('Failed to observe native model response', { error })
        })
      return stream
    }
  })
  await modelRuntime.setRuntimeApiKey(providerName, gateway.apiKey)
  const registered = modelRuntime.getModel(providerName, modelId)
  if (!registered) throw new Error(`Pi gateway model ${modelId} was not registered`)
  return { modelRuntime, model: registered }
}

function formatPiBaseUrl(baseUrl: string, api: PiApi): string {
  switch (api) {
    case 'openai-completions':
    case 'openai-responses':
      return formatApiHost(baseUrl)
    case 'google-generative-ai':
      return formatApiHost(baseUrl, true, 'v1beta')
    case 'anthropic-messages':
      // Anthropic's SDK appends `/v1/messages` itself.
      return withoutTrailingApiVersion(formatApiHost(baseUrl, false))
  }
}
