import { application } from '@application'
import { loggerService } from '@logger'
import { AGENT_RUNTIME_CAPABILITY_HEADER } from '@main/ai/agentSession/agentRuntimeCapability'
import { CHERRY_FAST_MODE_HEADER, CHERRY_REASONING_EFFORT_HEADER, CHERRY_SERVICE_TIER_HEADER } from '@main/ai/constants'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { ENDPOINT_TYPE, ServiceTierSelectionSchema } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

import type { InputFormat, InputParamsMap, OutputFormat } from './adapters'
import { CLIENT_IDENTITY_HEADERS, selectClientIdentity } from './clientIdentity'
import { resolveGatewayModelAddress } from './utils/models'

const logger = loggerService.withContext('GatewayRequest')

/** Union of all supported input params. */
type InputParams = InputParamsMap[InputFormat]

/**
 * Configuration for a gateway message request (streaming or non-streaming).
 * Routes pass `{ params, inputFormat, outputFormat, signal }`.
 */
export interface MessageConfig {
  provider?: Provider
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
  /** Raw request headers for authenticated internal correlation and client identity. */
  requestHeaders?: Headers
  onError?: (error: unknown) => void
  onComplete?: () => void
}

/** Resolve the trusted routing envelope without converting the caller payload. */
export async function resolveGatewayRequest(config: MessageConfig) {
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
  const isInternalRequest = config.requestHeaders
    ? application.get('ApiGatewayService').isInternalRequest(config.requestHeaders)
    : false
  const reasoningHeader = isInternalRequest ? config.requestHeaders?.get(CHERRY_REASONING_EFFORT_HEADER) : null
  const tierHeader = isInternalRequest ? config.requestHeaders?.get(CHERRY_SERVICE_TIER_HEADER) : null
  const reasoning = ReasoningEffortOptionSchema.safeParse(reasoningHeader ?? undefined)
  const tier = ServiceTierSelectionSchema.safeParse(tierHeader ?? undefined)
  if ((reasoningHeader && !reasoning.success) || (tierHeader && !tier.success))
    throw asClientError(new Error('Invalid internal Agent request options'))
  const turnOptions = {
    ...(reasoning.success ? { reasoningEffort: reasoning.data } : {}),
    ...(tier.success ? { serviceTier: tier.data } : {}),
    fastMode:
      config.fastMode === true || (isInternalRequest && config.requestHeaders?.get(CHERRY_FAST_MODE_HEADER) === 'true')
  }
  const resolvedAddress = await resolveGatewayModelAddress(modelString, isInternalRequest)
  const { providerId, apiModelId: modelId, uniqueModelId, provider: resolvedProvider } = resolvedAddress
  const runtimeCapability = config.requestHeaders
    ? application.get('ApiGatewayService').resolveRuntimeCapability(config.requestHeaders)
    : undefined
  const agentSessionId =
    runtimeCapability?.sessionId ??
    (config.requestHeaders ? application.get('ApiGatewayService').getAgentSessionId(config.requestHeaders) : undefined)
  // agentSessionId lets System Doctor attribute this upstream hop to the Agent session that made it.
  const logContext = { providerId, modelId, ...(agentSessionId ? { agentSessionId } : {}) }

  const isStreaming = config.streaming ?? ('stream' in params && (params as { stream?: boolean }).stream === true)

  logger.info(`Starting ${isStreaming ? 'streaming' : 'non-streaming'} message`, {
    ...logContext,
    inputFormat,
    outputFormat
  })

  const provider: Provider = config.provider ?? resolvedProvider
  const isInternalAnthropicAgentRequest = inputFormat === 'anthropic' && isInternalRequest
  const endpoint = resolveEffectiveEndpoint(
    provider,
    resolvedAddress.model,
    isInternalAnthropicAgentRequest ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES : undefined
  )
  const clientIdentityHeaders =
    isInternalAnthropicAgentRequest &&
    config.requestHeaders &&
    runtimeCapability?.runtime === 'claude-code' &&
    CLIENT_IDENTITY_HEADERS.some((name) => config.requestHeaders?.has(name))
      ? await selectClientIdentity({
          requestHeaders: config.requestHeaders,
          provider,
          agentType: runtimeCapability.runtime,
          endpointType: endpoint.endpointType,
          model: resolvedAddress.model,
          forbiddenValues: [
            config.requestHeaders.get('x-api-key')?.trim() ||
              config.requestHeaders
                .get('authorization')
                ?.match(/^Bearer\s+(.+)$/i)?.[1]
                ?.trim() ||
              config.requestHeaders.get('x-goog-api-key')?.trim() ||
              '',
            config.requestHeaders.get(AGENT_RUNTIME_CAPABILITY_HEADER) ?? ''
          ]
        })
      : undefined
  const model =
    endpoint.endpointType && endpoint.endpointType !== resolvedAddress.model.endpointTypes?.[0]
      ? { ...resolvedAddress.model, endpointTypes: [endpoint.endpointType] }
      : resolvedAddress.model
  const resolvedModel = { provider, model }
  return {
    inputFormat,
    outputFormat,
    params,
    provider,
    model,
    resolvedModel,
    endpoint,
    isInternalAnthropicAgentRequest,
    isStreaming,
    clientIdentityHeaders,
    agentSessionId,
    turnOptions,
    reasoning,
    uniqueModelId,
    modelId,
    logContext,
    asClientError
  }
}
