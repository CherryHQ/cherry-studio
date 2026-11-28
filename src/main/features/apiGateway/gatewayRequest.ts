import { application } from '@application'
import { loggerService } from '@logger'
import { CHERRY_FAST_MODE_HEADER, CHERRY_REASONING_EFFORT_HEADER, CHERRY_SERVICE_TIER_HEADER } from '@main/ai/constants'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import type { RecoverableModelTransportFailure } from '@main/ai/runtime/aiSdk'
import type { InProcessUsageContext } from '@main/ai/types'
import {
  ENDPOINT_TYPE,
  type EndpointType,
  type ServiceTierSelection,
  ServiceTierSelectionSchema
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { RetryPartData } from '@shared/data/types/uiParts'
import { type ReasoningEffortOption, ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

import type { InputFormat, InputParamsMap, OutputFormat } from './adapters'
import { resolveGatewayModelAddress } from './utils/models'

const logger = loggerService.withContext('GatewayRequest')

/** Union of all supported input params. */
type InputParams = InputParamsMap[InputFormat]

/** Trusted object-call state; HTTP routes never populate this field. */
export interface AgentGatewayContext {
  agentSessionId: string
  replayRouteId?: string
  omitGeminiSignaturesFor?: ReadonlySet<number>
  reasoningEffort: ReasoningEffortOption
  serviceTier?: ServiceTierSelection
  fastMode: boolean
  onRetryEvent?: (event: RetryPartData) => void
  onModelTransportFailure?: (failure: RecoverableModelTransportFailure) => void
  resolveUsage(responseId: string): InProcessUsageContext | undefined
}

/**
 * Configuration for a gateway message request (streaming or non-streaming).
 * Routes pass `{ params, inputFormat, outputFormat, signal }`.
 */
export interface MessageConfig {
  provider?: Provider
  /** Route-owned default when the caller did not supply internal reasoning options. */
  defaultReasoningEffort?: ReasoningEffortOption
  modelId?: string
  /** Internal Agent-session hint carried by the Claude Code SDK gateway route. */
  fastMode?: boolean
  /**
   * The loosely-validated gateway request body. Routes validate only the fields
   * the gateway needs (`model`, `messages`/`input`, …) and pass the rest through,
   * so this is `unknown` at the boundary and narrowed to the format's SDK type
   * below — the converters parse the full payload defensively.
   */
  params: unknown
  /**
   * Explicit `"providerId:modelId"` addressing. The OpenAI/Anthropic dialects
   * carry the model in the body (`params.model`); Gemini carries it in the URL
   * path, so its route passes it here to override the body lookup.
   */
  modelString?: string
  /**
   * Explicit streaming flag. The OpenAI/Anthropic dialects signal streaming via
   * `params.stream`; Gemini signals it via the `:streamGenerateContent` method,
   * so its route passes the resolved flag here.
   */
  streaming?: boolean
  inputFormat?: InputFormat
  outputFormat?: OutputFormat
  /** Request abort signal (`context.request.signal`); aborts the upstream stream on client disconnect. */
  signal?: AbortSignal
  /** Raw request headers used only to validate Cherry-internal usage correlation. */
  requestHeaders?: Headers
  agentContext?: AgentGatewayContext
  onError?: (error: unknown) => void
  onComplete?: () => void
}

/** Read the authenticated request envelope before admitting an upstream model. */
export function readGatewayRequest(config: MessageConfig) {
  const { inputFormat = 'anthropic', outputFormat = 'anthropic' } = config
  // Trust boundary: narrow the loosely-validated body to the format's SDK type once.
  const params = config.params as InputParams

  // Client-addressing mistakes are 400s, not 500s. Notably gemini-cli's internal
  // utility calls (chat compression, classification) hardcode bare `gemini-*-flash-lite`
  // model names that can never carry the gateway's providerId prefix — those requests
  // fail here by design (gemini-cli swallows them silently) and must not read as
  // gateway server errors in the logs.
  const asClientError = (error: unknown): Error & { status: number } => {
    const err = (error instanceof Error ? error : new Error(String(error))) as Error & { status: number }
    err.status = 400
    return err
  }

  // 1. Resolve the external "providerId:apiModelId" address from Gemini's URL-path
  // override or the request body, then map it to the internal model id.
  const modelString = config.modelString ?? ('model' in params ? (params as { model?: string }).model : undefined)
  if (!modelString || typeof modelString !== 'string') {
    throw asClientError(new Error('Request is missing a "model" field'))
  }
  const isInternalRequest =
    config.agentContext !== undefined ||
    (config.requestHeaders ? application.get('ApiGatewayService').isInternalRequest(config.requestHeaders) : false)
  const reasoningHeader = config.agentContext
    ? config.agentContext.reasoningEffort
    : isInternalRequest
      ? config.requestHeaders?.get(CHERRY_REASONING_EFFORT_HEADER)
      : null
  const tierHeader = config.agentContext
    ? config.agentContext.serviceTier
    : isInternalRequest
      ? config.requestHeaders?.get(CHERRY_SERVICE_TIER_HEADER)
      : null
  const reasoning = ReasoningEffortOptionSchema.safeParse(reasoningHeader ?? config.defaultReasoningEffort)
  const tier = ServiceTierSelectionSchema.safeParse(tierHeader ?? undefined)
  if ((reasoningHeader && !reasoning.success) || (tierHeader && !tier.success))
    throw asClientError(new Error('Invalid internal Agent request options'))
  const turnOptions = {
    ...(reasoning.success ? { reasoningEffort: reasoning.data } : {}),
    ...(tier.success ? { serviceTier: tier.data } : {}),
    fastMode:
      config.agentContext?.fastMode ??
      (config.fastMode === true ||
        (isInternalRequest && config.requestHeaders?.get(CHERRY_FAST_MODE_HEADER) === 'true'))
  }
  const agentSessionId =
    config.agentContext?.agentSessionId ??
    (config.requestHeaders ? application.get('ApiGatewayService').getAgentSessionId(config.requestHeaders) : undefined)
  const isInternalAnthropicAgentRequest = inputFormat === 'anthropic' && isInternalRequest
  const isStreaming = config.streaming ?? ('stream' in params && (params as { stream?: boolean }).stream === true)
  return {
    inputFormat,
    outputFormat,
    params,
    modelString,
    isInternalRequest,
    isInternalAnthropicAgentRequest,
    isStreaming,
    agentSessionId,
    turnOptions,
    reasoning,
    asClientError
  }
}

export async function resolveGatewayRequest(
  config: MessageConfig,
  incoming: ReturnType<typeof readGatewayRequest>,
  continuation?: { source: { modelAddress: string; endpointType?: EndpointType }; routeId: string }
) {
  const { inputFormat, outputFormat, isInternalRequest, isInternalAnthropicAgentRequest, isStreaming, agentSessionId } =
    incoming
  const modelAddress = continuation?.source.modelAddress ?? incoming.modelString
  const resolvedAddress = await resolveGatewayModelAddress(modelAddress, isInternalRequest)
  const { providerId, apiModelId: modelId, uniqueModelId, provider: resolvedProvider } = resolvedAddress
  const logContext = { providerId, modelId, ...(agentSessionId ? { agentSessionId } : {}) }

  logger.info(`Starting ${isStreaming ? 'streaming' : 'non-streaming'} message`, {
    ...logContext,
    inputFormat,
    outputFormat
  })

  const provider: Provider = config.provider ?? resolvedProvider
  const endpoint = resolveEffectiveEndpoint(
    provider,
    resolvedAddress.model,
    continuation?.source.endpointType ??
      (isInternalAnthropicAgentRequest ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES : undefined)
  )
  const model =
    endpoint.endpointType && endpoint.endpointType !== resolvedAddress.model.endpointTypes?.[0]
      ? { ...resolvedAddress.model, endpointTypes: [endpoint.endpointType] }
      : resolvedAddress.model
  const resolvedModel = { provider, model, replayRouteId: continuation?.routeId ?? config.agentContext?.replayRouteId }
  return {
    ...incoming,
    provider,
    model,
    resolvedModel,
    endpoint,
    uniqueModelId,
    modelId,
    modelAddress,
    logContext
  }
}
