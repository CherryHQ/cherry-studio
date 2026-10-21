import type { Usage } from '@earendil-works/pi-ai'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'

import { loggerService } from '@logger'
import { CHERRY_FAST_MODE_HEADER, CHERRY_REASONING_EFFORT_HEADER, CHERRY_SERVICE_TIER_HEADER } from '@main/ai/constants'
import { startAgentRuntimeChildSpan, endAgentRuntimeSpan } from '@main/ai/observability'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveApiGatewayRuntime } from '../agentApiGateway'
import type { AgentRuntimeConnectInput } from '../types'
import { buildPiGatewayInjection, materializePiProviderStream } from './modelInjection'
import { loadPiAi, loadPiSdk } from './piSdk'

/** Native Pi protocols target Cherry's internal gateway; Cherry retains provider credentials and billing. */
export async function createPiGatewayModelBinding(
  input: Pick<AgentRuntimeConnectInput, 'sessionId' | 'reasoningEffort' | 'serviceTier' | 'fastMode' | 'trace'>,
  provider: Provider,
  model: Model,
  onUsage?: (usage: Usage) => void
) {
  const injection = buildPiGatewayInjection(provider, model, await resolveApiGatewayRuntime(input.sessionId))
  const [{ InMemoryCredentialStore }, { ModelRuntime }, native] = await Promise.all([
    loadPiAi(),
    loadPiSdk(),
    materializePiProviderStream(injection)
  ])
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider(injection.providerName, {
    ...native.providerConfig,
    headers: {
      ...native.providerConfig.headers,
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
      const stream = native.streamSimple(model, context, { ...options, maxRetries: 0 })
      void stream
        .result()
        .then((message) => {
          onUsage?.(message.usage)
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
  await modelRuntime.setRuntimeApiKey(injection.providerName, injection.apiKey)
  const registered = modelRuntime.getModel(injection.providerName, injection.modelId)
  if (!registered) throw new Error(`Pi gateway model ${injection.modelId} was not registered`)
  return { modelRuntime, model: registered }
}
