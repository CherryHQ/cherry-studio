import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { application } from '@application'
import type { AiPlugin } from '@cherrystudio/ai-core'
import { projectRuntimeReasoning, providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import { resolveRequestedMaxOutputTokens } from '@main/ai/contextBuild/resolveOutputReservation'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { getProviderById, getProviderForCapability, isPermanentWebSearchConfigError } from '@main/services/webSearch'
import {
  FS_READ_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '@shared/ai/builtinTools'
import type { CompactionSink } from '@shared/ai/compaction'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import {
  type Assistant,
  DEFAULT_ASSISTANT_SETTINGS,
  MAX_TOOL_CALLS,
  MIN_TOOL_CALLS
} from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isDeepSeekModel, isFunctionCallingModel } from '@shared/utils/model'
import { finalizeWebToolRoutes, resolveWebToolRoutes, type WebToolRoutes } from '@shared/utils/provider'
import { getWebSearchFallbackProviderIds, resolveReadyWebSearchProvider } from '@shared/utils/webSearch'
import { stepCountIs, type StopCondition, type ToolSet, type UIMessage } from 'ai'

import { resolveRequestContextSettings } from '../../../contextBuild/resolveRequestContextSettings'
import type { FileAttachmentRef } from '../../../messages/attachmentTypes'
import { collectRetainedContext, type RetainedContext } from '../../../messages/retainedContext'
import { createHttpTraceFetch } from '../../../observability'
import { resolveProviderAiSdkConfig } from '../../../provider/config'
import type { ServingCredentialReceipt } from '../../../provider/credential'
import {
  resolveAiSdkProviderId,
  type ResolvedEndpoint,
  resolveEffectiveEndpoint,
  resolveProviderOptionsKey,
  resolveWireModelId
} from '../../../provider/endpoint'
import type { RequestContext } from '../../../tools/adapters/aiSdk/context'
import { applyDeferExposition } from '../../../tools/adapters/aiSdk/exposition/applyDeferExposition'
import { syncMcpToolsToRegistry } from '../../../tools/adapters/aiSdk/mcp/mcpTools'
import {
  resolveAssistantMcpToolIds,
  resolveMcpResourceServers
} from '../../../tools/adapters/aiSdk/mcp/resolveAssistantMcpTools'
import { registry, ToolRegistry } from '../../../tools/adapters/aiSdk/registry'
import { createAiRepair } from '../../../tools/adapters/aiSdk/repair'
import type { ToolEntry } from '../../../tools/adapters/aiSdk/types'
import { resolveConfiguredPaintingModel } from '../../../tools/painting'
import type { AiBaseRequest, CallOverrides } from '../../../types'
import {
  adjustMaxOutputTokensForReasoning,
  filterStandardParams,
  getTemperature,
  getTopP
} from '../../../utils/modelParameters'
import {
  applyFastModeToProviderOptions,
  applyServiceTierToProviderOptions,
  buildCapabilityProviderOptions,
  extractAiSdkStandardParams,
  mergeCustomProviderParameters,
  resolveServiceTierWireValue
} from '../../../utils/options'
import { getCustomParameters } from '../../../utils/reasoning'
import { resolveReasoningInvocation } from '../../../utils/reasoningSerializers'
import { createToolCallLimitStopCondition } from '../loop/toolLoopTermination'
import type { AgentLoopHooks, AgentOptions } from '../loop/types'
import { assembleSystemPrompt } from './assembleSystemPrompt'
import { buildTelemetry } from './buildTelemetry'
import { resolveCapabilities } from './capabilities'
import { collectFromFeatures } from './collectFromFeatures'
import { createCustomParamsFetch, selectCustomBodyParameters } from './customParamsFetch'
import type { RequestFeature } from './feature'
import { hasAnchorRow } from './features/contextBuild'
import { INTERNAL_FEATURES } from './features/internalFeatures'
import { type NativeFileSupport, resolveNativeFileSupport } from './nativeFileSupport'
import type { RequestScope, SdkConfig } from './scope'

const logger = loggerService.withContext('buildAgentParams')
const CITABLE_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  KB_READ_TOOL_NAME
])
const NO_WEB_TOOL_ROUTES: WebToolRoutes = { webSearch: 'none', webFetch: 'none' }

export interface BuildAgentParamsInput {
  request: AiBaseRequest & {
    chatId?: string
    messageId?: string
    messages?: UIMessage[]
    /** Raw-path surviving context from the chat provider (see AiStreamRequest.retainedContext). */
    retainedContext?: RetainedContext
  }
  signal: AbortSignal | undefined
  provider: Provider
  model: Model
  assistant?: Assistant
  /** Caller-supplied features merged after `INTERNAL_FEATURES`. */
  extraFeatures?: readonly RequestFeature[]
  /** Late-bound request usage middleware for nested tool-repair calls. */
  getRepairUsagePlugins?: () => AiPlugin[]
  /** Reports compaction progress to the UI; absent when there is no live stream. */
  compactionSink?: CompactionSink
}

export interface BuiltAgentParams {
  sdkConfig: SdkConfig
  /** Non-secret receipt for the credential path selected for this request. */
  credentialReceipt: ServingCredentialReceipt
  tools: ToolSet | undefined
  plugins: AiPlugin<any, any>[]
  system: string | undefined
  options: AgentOptions
  /** Hook contributions from features — caller composes with its own internal hooks. */
  hookParts: ReadonlyArray<Partial<AgentLoopHooks>>
  /** Attachment routing inputs for `prepareChatMessages` (chat path). */
  nativeFileSupport: NativeFileSupport
  fileAttachments: FileAttachmentRef[]
}

export async function buildAgentParams(input: BuildAgentParamsInput): Promise<BuiltAgentParams> {
  const { request, signal, provider, model, assistant, extraFeatures, compactionSink } = input

  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const { sdkConfig, credentialReceipt } = await resolveSdkConfig(
    provider,
    model,
    resolvedEndpoint,
    request.apiKeyOverride,
    request.chatId
  )
  applyHttpTrace(sdkConfig, request.chatId, model)
  // Prefer the request-carried retained context: the persistent chat provider
  // computes it from the RAW message path, so attachments and persisted tool
  // outputs folded away by durable compaction stay readable via read_file /
  // fs_read. Scanning `messages` only sees the served (post-fold) view — the
  // fallback is for providers that never fold (temporary chat, agent).
  const retained = request.retainedContext ?? collectRetainedContext(request.messages ?? [])
  const fileAttachments = retained.fileAttachments
  const hasFileAttachments = fileAttachments.length > 0
  // Resolved before tool selection (fs_read's applies gate) and the tool
  // context (fs_read's per-call cap follows the effective persist threshold).
  const { contextSettings, compressionModel } = await resolveRequestContextSettings(
    model,
    assistant?.settings.contextSettings
  )
  const hasPersistedOutputs = retained.persistedOutputPaths.size > 0
  // A marker minted on the last permitted tool step can never be read back —
  // the producing tool consumes that step and the loop ends.
  const hasReadBackStep = resolveToolCallLimit(assistant) > 1
  // Every condition a <persisted-output> marker needs to appear this request;
  // `resolveTruncateStorage` reuses the result rather than re-querying the row.
  const canOffloadToolOutputs =
    contextSettings.enabled && request.contextOwner !== 'caller' && hasAnchorRow(request.messageId) && hasReadBackStep
  const knowledgeBaseIds = resolveKnowledgeBaseScope(assistant?.knowledgeBaseIds, request.knowledgeBaseIds)
  const toolSignals = canModelConsumeTools(model) ? await resolveRequestToolSignals(request, assistant) : undefined
  const webToolRoutes = await resolveRequestWebToolRoutes(model, provider, assistant, {
    endpointType: resolvedEndpoint.endpointType,
    hasFunctionToolSignals: toolSignals
      ? toolSignals.mcpToolIds.size > 0 ||
        // Same `applies` gate the mcp_resource_* tools use, so a resource-only assistant is not
        // mistaken for a request that loads no function tool.
        toolSignals.mcpResourceServerIds.size > 0 ||
        // Mirrors the KB tools' own `applies`: owning a base is not enough, this request must also
        // scope one. ORing the two made every user with any KB look like a function-tool conflict,
        // which withheld the server web-search route on Gemini 2.5 for requests that load no tool.
        (toolSignals.hasAnyKnowledgeBase && knowledgeBaseIds.length > 0) ||
        hasFileAttachments ||
        Object.keys(request.callOverrides?.tools ?? {}).length > 0 ||
        assistant?.settings.enableGenerateImage === true
      : false,
    reasoningEffort: request.reasoningEffort ?? assistant?.settings.reasoning_effort
  })
  const { tools, deferredEntries, hasCitableTools, mcpToolIds, mcpResourceServerIds } = toolSignals
    ? await resolveTools(
        request,
        assistant,
        model,
        hasFileAttachments,
        knowledgeBaseIds,
        webToolRoutes,
        toolSignals,
        hasPersistedOutputs,
        canOffloadToolOutputs
      )
    : {
        tools: isDeepSeekModel(model) ? request.callOverrides?.tools : undefined,
        deferredEntries: [] as ToolEntry[],
        hasCitableTools: false,
        mcpToolIds: new Set<string>(),
        mcpResourceServerIds: new Set<string>()
      }
  const hasFunctionTools = tools !== undefined && Object.keys(tools).length > 0
  const finalWebToolRoutes = finalizeWebToolRoutes(webToolRoutes, model, provider, hasFunctionTools)
  const capabilities = assistant
    ? resolveCapabilities(model, provider, assistant, {
        webToolRoutes: finalWebToolRoutes,
        runtimeProviderId: sdkConfig.providerId,
        serving: sdkConfig.providerSettings
      })
    : undefined

  const { endpointType } = resolvedEndpoint
  const aiSdkProviderId = resolveAiSdkProviderId(provider, endpointType)
  const runtimeProviderId = sdkConfig.providerId
  const reasoningEndpointType =
    runtimeProviderId === 'google-vertex-maas' ? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS : endpointType
  const reasoningProfile = providerRegistryService.resolveReasoningProfile(provider, model, reasoningEndpointType)
  const serviceTierControl = providerRegistryService.resolveServiceTierControl(provider, model, endpointType)
  const invocationModel = reasoningProfile.support
    ? { ...model, reasoning: projectRuntimeReasoning(reasoningProfile.support, reasoningProfile.wire) }
    : model
  const customParameters = extractAiSdkStandardParams(assistant ? getCustomParameters(assistant) : {})
  customParameters.standardParams = filterStandardParams(customParameters.standardParams, model)
  const requestedMaxOutputTokens = resolveRequestedMaxOutputTokens(
    request.callOverrides?.maxOutputTokens,
    customParameters.standardParams.maxOutputTokens,
    assistant,
    model,
    endpointType
  )
  const requestedReasoningSelection = request.reasoningEffort ?? assistant?.settings.reasoning_effort ?? 'default'
  const reasoningSelection =
    requestedReasoningSelection === 'auto' && !invocationModel.reasoning?.selectableEfforts.includes('auto')
      ? 'default'
      : requestedReasoningSelection
  const reasoning = resolveReasoningInvocation({
    selection: reasoningSelection,
    model: invocationModel,
    profile: reasoningProfile.wire,
    maxTokens: requestedMaxOutputTokens ?? model.maxOutputTokens,
    assistantSummary: assistant?.settings.reasoning_summary
  })
  const nativeFileSupport = resolveNativeFileSupport(provider, model, {
    endpointType,
    aiSdkProviderId,
    runtimeProviderId
  })

  const requestContext: RequestContext = {
    requestId: request.messageId ?? crypto.randomUUID(),
    topicId: request.chatId,
    assistant,
    abortSignal: signal,
    fileAttachments,
    knowledgeBaseIds,
    // fs_read's exact allow-list: blobs referenced by the conversation, plus
    // whatever the in-flight offload adapter appends mid-turn. Cloned so those
    // per-turn appends never contaminate the RetainedContext shared across the
    // models of a multi-model send.
    persistedOutputPaths: new Set(retained.persistedOutputPaths),
    // Frozen with the tool set: `mcp_resource_*` may only ever narrow this at execution time.
    mcpResourceServerIds,
    toolOutputCharCap: contextSettings.truncateThreshold
  }

  const scope: RequestScope = {
    request,
    signal,
    registry,
    assistant,
    model,
    provider,
    capabilities,
    sdkConfig,
    endpointType,
    aiSdkProviderId,
    reasoningProfile,
    reasoning,
    serviceTierControl,
    requestContext,
    mcpToolIds,
    mcpResourceServerIds,
    contextSettings,
    compressionModel,
    compactionSink,
    webToolRoutes: finalWebToolRoutes,
    hasFileAttachments,
    hasPersistedOutputs,
    canOffloadToolOutputs,
    knowledgeBaseIds
  }

  const features = extraFeatures?.length ? [...INTERNAL_FEATURES, ...extraFeatures] : INTERNAL_FEATURES
  const contributions = collectFromFeatures(scope, features)

  const system = await assembleSystemPrompt({
    assistant,
    model,
    tools,
    deferredEntries,
    hasCitableTools,
    webSearchEnabled: finalWebToolRoutes.webSearch !== 'none'
  })
  const options = buildAgentOptions(
    scope,
    contributions.stopConditions,
    customParameters,
    requestedMaxOutputTokens,
    input.getRepairUsagePlugins
  )
  applyResponsesInstructions(options, system, endpointType, sdkConfig.providerOptionsKey)

  return {
    sdkConfig,
    credentialReceipt,
    tools,
    plugins: contributions.modelAdapters,
    system,
    options,
    hookParts: contributions.hookParts,
    nativeFileSupport,
    fileAttachments
  }
}

/**
 * OpenAI Responses API expects the system prompt in the top-level `instructions`
 * field. The AI SDK only turns `system` into an input message and leaves
 * `instructions` empty, which lets relay servers inject their own default system
 * prompt and override the user's. Mirror the assembled system prompt there for
 * Responses-endpoint models, unless the user already set it explicitly. (#16008)
 */
export function applyResponsesInstructions(
  options: AgentOptions,
  system: string | undefined,
  endpointType: EndpointType | undefined,
  providerOptionsKey: string
): void {
  if (!system || endpointType !== ENDPOINT_TYPE.OPENAI_RESPONSES) return
  const providerOptions = (options.providerOptions ??= {})
  const namespace = (providerOptions[providerOptionsKey] ??= {})
  if (namespace.instructions != null) return
  namespace.instructions = system
  // `instructions` does not displace the system input message; without this the
  // whole prompt ships twice.
  namespace.systemMessageMode = 'remove'
}

async function resolveSdkConfig(
  provider: Provider,
  model: Model,
  resolvedEndpoint: ResolvedEndpoint,
  apiKeyOverride?: string,
  sessionId?: string
): Promise<{ sdkConfig: SdkConfig; credentialReceipt: ServingCredentialReceipt }> {
  const { config, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model, {
    apiKeyOverride,
    resolvedEndpoint,
    sessionId
  })
  return {
    sdkConfig: {
      ...config,
      providerOptionsKey: resolveProviderOptionsKey(config.providerId, {
        actualProviderId: provider.id,
        endpointType: resolvedEndpoint.endpointType,
        gatewayProviderOptionsKey: resolvedEndpoint.providerOptionsKey
      }),
      modelId: resolveWireModelId(model, resolvedEndpoint.endpointType)
    },
    credentialReceipt
  }
}

export function applyHttpTrace(sdkConfig: SdkConfig, topicId: string | undefined, model: Model): void {
  if (!application.get('PreferenceService').get('app.developer_mode.enabled')) return
  const settings = sdkConfig.providerSettings
  settings.fetch = createHttpTraceFetch(settings.fetch ?? globalThis.fetch, {
    topicId,
    modelName: model.name ?? model.id
  })
}

/**
 * Skip the entire tool-resolution path (registry sync, defer exposition,
 * meta-tool injection) when the model can't consume tools at all. Without
 * this gate, a non-function-calling model gets the meta-tools + system-
 * prompt section pushed at it for nothing — pure token waste with no way
 * for the model to act on it.
 *
 * "Can consume" means the model supports native function calling (the
 * provider's tool API).
 */
function canModelConsumeTools(model: Model): boolean {
  return isFunctionCallingModel(model)
}

/**
 * Pre-tool-resolution signals — feed the web-tool routing and are reused by `resolveTools`.
 *
 * `mcpResourceServerIds` is resolved (and frozen) here rather than inside `resolveTools` because web
 * routing runs first and has to know that this request will carry function tools: a resource-only
 * assistant that reported "no function tools" would be routed to a provider's server web route, and
 * `finalizeWebToolRoutes` can only withdraw that route afterwards, not fall back to the client one.
 */
async function resolveRequestToolSignals(
  request: BuildAgentParamsInput['request'],
  assistant: Assistant | undefined
): Promise<{
  mcpToolIds: ReadonlySet<string>
  mcpResourceServerIds: ReadonlySet<string>
  hasAnyKnowledgeBase: boolean
}> {
  let mcpIdList = request.mcpToolIds
  if (!mcpIdList && request.assistantId) {
    mcpIdList = await resolveAssistantMcpToolIds(request.assistantId)
  }
  return {
    mcpToolIds: new Set(mcpIdList ?? []),
    mcpResourceServerIds: new Set(resolveMcpResourceServers(assistant).map((server) => server.id)),
    hasAnyKnowledgeBase: resolveHasAnyKnowledgeBase()
  }
}

/**
 * Tool selection: pick MCP ids (caller wins, else derived from assistant),
 * sync the MCP entries into the registry, then materialise the active
 * `ToolSet` via `applies` predicates and defer exposition.
 */
export async function resolveTools(
  request: BuildAgentParamsInput['request'],
  assistant: Assistant | undefined,
  model: Model,
  hasFileAttachments: boolean,
  knowledgeBaseIds: readonly string[],
  webToolRoutes: WebToolRoutes = NO_WEB_TOOL_ROUTES,
  signals?: Awaited<ReturnType<typeof resolveRequestToolSignals>>,
  hasPersistedOutputs: boolean = false,
  canOffloadToolOutputs: boolean = false
): Promise<{
  tools: ToolSet | undefined
  deferredEntries: ToolEntry[]
  hasCitableTools: boolean
  mcpToolIds: ReadonlySet<string>
  mcpResourceServerIds: ReadonlySet<string>
}> {
  const { mcpToolIds, mcpResourceServerIds, hasAnyKnowledgeBase } =
    signals ?? (await resolveRequestToolSignals(request, assistant))
  if (mcpToolIds.size) {
    // Reconcile selected tool ids against every active server's cache-only catalog,
    // resolving ownership by exact id without MCP network round trips.
    await syncMcpToolsToRegistry(undefined, { selectedToolIds: mcpToolIds })
  }

  const paintingModel = resolveConfiguredPaintingModel()
  const selected = registry.selectActive({
    assistant,
    paintingModel: paintingModel ?? undefined,
    mcpToolIds,
    mcpResourceServerIds,
    hasFileAttachments,
    hasPersistedOutputs,
    canOffloadToolOutputs,
    hasAnyKnowledgeBase,
    knowledgeBaseIds,
    webToolRoutes
  })
  // Client tools (no `execute`) from assistant-less callers; merged below so
  // they share the registry/defer-exposition path.
  const clientTools = request.callOverrides?.tools
  const clientToolNames = new Set(Object.keys(clientTools ?? {}))
  // A lone fs_read has nothing to read back: no other tool can produce an
  // offloadable output mid-loop (#18084).
  const activeEntries =
    !hasPersistedOutputs &&
    clientToolNames.size === 0 &&
    selected.length === 1 &&
    selected[0].name === FS_READ_TOOL_NAME
      ? []
      : selected
  let tools: ToolSet | undefined
  if (activeEntries.length > 0) {
    tools = {}
    for (const entry of activeEntries) tools[entry.name] = entry.tool
  }
  if (clientTools && Object.keys(clientTools).length > 0) {
    tools = {
      ...tools,
      ...clientTools
    }
  }
  // Meta-tools must see request-materialized entries rather than the process-wide static entries.
  const requestRegistry = new ToolRegistry()
  for (const entry of activeEntries) requestRegistry.register(entry)
  const exposed = await applyDeferExposition(tools, requestRegistry, model.contextWindow)
  const hasCitableTools = activeEntries.some(
    (entry) => CITABLE_BUILTIN_TOOL_NAMES.has(entry.name) && !clientToolNames.has(entry.name)
  )
  return {
    tools: exposed.tools,
    deferredEntries: exposed.deferredEntries,
    hasCitableTools,
    mcpToolIds,
    mcpResourceServerIds
  }
}

async function resolveRequestWebToolRoutes(
  model: Model,
  provider: Provider,
  assistant: Assistant | undefined,
  requestContext: {
    endpointType: EndpointType | undefined
    hasFunctionToolSignals: boolean
    reasoningEffort: string | undefined
  }
): Promise<WebToolRoutes> {
  if (!assistant) return NO_WEB_TOOL_ROUTES

  const preferenceService = application.get('PreferenceService')
  const clientWebToolsEnabled = assistant.settings.enableWebSearch === true
  const [clientSearchAvailable, clientFetchAvailable] = clientWebToolsEnabled
    ? await Promise.all([
        resolveClientWebCapabilityAvailability('searchKeywords'),
        resolveClientWebCapabilityAvailability('fetchUrls')
      ])
    : [false, false]
  const modelToolsPreferred = preferenceService.get('chat.web_search.model_tools_preferred')

  return resolveWebToolRoutes(model, provider, {
    webSearchEnabled: clientWebToolsEnabled,
    clientSearchAvailable,
    clientFetchAvailable,
    modelToolsPreferred,
    endpointType: requestContext.endpointType,
    hasFunctionToolSignals: requestContext.hasFunctionToolSignals,
    reasoningEffort: requestContext.reasoningEffort
  })

  async function resolveClientWebCapabilityAvailability(capability: WebSearchCapability): Promise<boolean> {
    try {
      const clientProvider = await getProviderForCapability(undefined, capability, preferenceService)
      const fallbackProviders = await Promise.all(
        getWebSearchFallbackProviderIds(clientProvider.id, capability).map((providerId) =>
          getProviderById(providerId, preferenceService)
        )
      )

      return Boolean(resolveReadyWebSearchProvider([clientProvider, ...fallbackProviders], clientProvider, capability))
    } catch (error) {
      if (!isPermanentWebSearchConfigError(error)) {
        logger.warn(`Failed to resolve the client ${capability} provider; falling back to the server tool`, { error })
      }
      return false
    }
  }
}

/**
 * Whether the user has any knowledge base, used to gate the `kb_*` tools in `selectActive`. Fail-open:
 * a transient count error must not suppress the KB tools for users who do have bases (the tools
 * themselves steer gracefully when a lookup fails), so an error is treated as "present".
 */
function resolveHasAnyKnowledgeBase(): boolean {
  try {
    return application.get('KnowledgeService').hasAnyBase()
  } catch (error) {
    logger.warn('Failed to check for knowledge bases during tool resolution; treating as present', { error })
    return true
  }
}

/**
 * Assemble `AgentOptions`: capability-driven providerOptions overlaid with
 * the user's customParameters (split into AI-SDK standard params vs
 * provider-scoped params), per-call headers/maxRetries, stop-after-N-tools,
 * and the tool-call repair function.
 */
function buildAgentOptions(
  scope: RequestScope,
  featureStopConditions: StopCondition<ToolSet>[],
  customParameters: ReturnType<typeof extractAiSdkStandardParams>,
  requestedMaxOutputTokens: number | undefined,
  getRepairUsagePlugins?: () => AiPlugin[]
): AgentOptions {
  const {
    assistant,
    capabilities,
    model,
    provider,
    sdkConfig,
    requestContext,
    request,
    aiSdkProviderId,
    endpointType,
    reasoning,
    serviceTierControl
  } = scope

  // One path for both callers, so protocol/model defaults (store, safetySettings, num_ctx…)
  // can't diverge. Assistant-less callers (translate, prompt streams) carry no capabilities;
  // they opt into reasoning by setting `request.reasoningEffort` explicitly.
  let providerOptions = buildCapabilityProviderOptions(
    model,
    provider,
    {
      enableReasoning: capabilities ? capabilities.enableReasoning : request.reasoningEffort !== undefined,
      enableGenerateImage: capabilities?.enableGenerateImage ?? false,
      enableWebSearch: capabilities ? scope.webToolRoutes?.webSearch === 'server' : false
    },
    {
      aiSdkProviderId,
      runtimeProviderId: sdkConfig.providerId,
      providerOptionsKey: sdkConfig.providerOptionsKey,
      endpointType,
      reasoning
    }
  )
  let standardParams: Partial<Record<string, unknown>> = {}
  if (assistant) {
    const temperature = getTemperature(assistant, model, reasoning)
    const topP = getTopP(assistant, model, reasoning)
    standardParams = {
      ...(temperature !== undefined && { temperature }),
      ...(topP !== undefined && { topP }),
      ...customParameters.standardParams
    }

    if (Object.keys(customParameters.providerParams).length > 0) {
      const customBodyParams = selectCustomBodyParameters(customParameters.providerParams, providerOptions, provider.id)
      providerOptions = mergeCustomProviderParameters(
        providerOptions,
        customParameters.providerParams,
        provider.id,
        sdkConfig.providerId === 'google-vertex-maas' ? 'openai-compatible' : aiSdkProviderId
      )
      if (Object.keys(customBodyParams).length > 0) {
        sdkConfig.providerSettings.fetch = createCustomParamsFetch(
          sdkConfig.providerSettings.fetch ?? globalThis.fetch,
          customBodyParams
        )
      }
    }
  }

  if (serviceTierControl) {
    providerOptions = applyServiceTierToProviderOptions(
      providerOptions,
      sdkConfig.providerOptionsKey,
      serviceTierControl,
      request.serviceTier ?? assistant?.settings.service_tier
    )
    if (serviceTierControl.wire.delivery.type === 'request-body') {
      sdkConfig.providerSettings.fetch = createCustomParamsFetch(sdkConfig.providerSettings.fetch ?? globalThis.fetch, {
        [serviceTierControl.wire.delivery.key]: resolveServiceTierWireValue(
          serviceTierControl,
          request.serviceTier ?? assistant?.settings.service_tier
        )
      })
    }
  }

  // Highest-precedence per-request overrides (assistant-less callers, e.g. the API gateway).
  const callOverrides = request.callOverrides
  const overridden = applyCallOverrides({ standardParams, providerOptions }, callOverrides, model)
  standardParams = overridden.standardParams
  const effectiveProviderOptions = applyFastModeToProviderOptions(
    provider,
    model,
    overridden.providerOptions,
    request.fastMode === true
  )
  // A namespace that ended up empty carries nothing; emitting it would ship a bare
  // `providerOptions` for callers that opted into nothing.
  const hasProviderOptions = Object.values(effectiveProviderOptions).some((ns) => Object.keys(ns ?? {}).length > 0)
  const effectiveBudgetTokens = resolveEffectiveThinkingBudget(
    effectiveProviderOptions,
    sdkConfig.providerOptionsKey,
    reasoning.budgetTokens
  )
  const maxOutputTokens = adjustMaxOutputTokensForReasoning(requestedMaxOutputTokens, endpointType, {
    budgetTokens: effectiveBudgetTokens
  })
  if (maxOutputTokens !== undefined) {
    standardParams = { ...standardParams, maxOutputTokens }
  } else if ('maxOutputTokens' in standardParams) {
    standardParams = { ...standardParams }
    delete standardParams.maxOutputTokens
  }

  const { headers, maxRetries } = request.requestOptions ?? {}
  const toolCallLimit = resolveToolCallLimit(assistant)
  const baseStopWhen = createToolCallLimitStopCondition(toolCallLimit)
  const stopWhen = composeStopWhen(baseStopWhen, featureStopConditions)
  const telemetry = buildTelemetry(scope)

  return {
    maxRetries: maxRetries ?? 0,
    ...(stopWhen && { stopWhen }),
    ...(headers && { headers }),
    ...(callOverrides?.toolChoice && { toolChoice: callOverrides.toolChoice }),
    ...(hasProviderOptions && { providerOptions: effectiveProviderOptions }),
    ...(telemetry && { telemetry }),
    ...standardParams,
    context: requestContext,
    repairToolCall: createAiRepair({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId,
      getUsagePlugins: getRepairUsagePlugins
    })
  }
}

function resolveEffectiveThinkingBudget(
  providerOptions: ProviderOptions,
  providerOptionsKey: string,
  fallbackBudgetTokens: number | undefined
): number | undefined {
  const thinking = providerOptions[providerOptionsKey]?.thinking
  if (thinking === undefined) return fallbackBudgetTokens
  if (thinking === null || typeof thinking !== 'object' || Array.isArray(thinking)) return undefined

  const thinkingOptions = thinking as Record<string, unknown>
  return thinkingOptions.type === 'enabled' && typeof thinkingOptions.budgetTokens === 'number'
    ? thinkingOptions.budgetTokens
    : undefined
}

/**
 * Merge per-request `callOverrides` (highest precedence) onto base sampling params +
 * providerOptions. Sampling passes through `filterStandardParams` for model-capability
 * gating (e.g. topK dropped for Gemini 3.x / Claude 4.7); providerOptions merge
 * per-provider so other providers' keys aren't clobbered. Exported for unit testing.
 */
export function applyCallOverrides(
  base: { standardParams: Partial<Record<string, unknown>>; providerOptions: ProviderOptions },
  callOverrides: CallOverrides | undefined,
  model: Model
): { standardParams: Partial<Record<string, unknown>>; providerOptions: ProviderOptions } {
  if (!callOverrides) return base

  const sampling: Partial<Record<string, unknown>> = {}
  if (callOverrides.temperature !== undefined) sampling.temperature = callOverrides.temperature
  if (callOverrides.maxOutputTokens !== undefined) sampling.maxOutputTokens = callOverrides.maxOutputTokens
  if (callOverrides.topP !== undefined) sampling.topP = callOverrides.topP
  if (callOverrides.topK !== undefined) sampling.topK = callOverrides.topK
  if (callOverrides.stopSequences !== undefined) sampling.stopSequences = callOverrides.stopSequences
  const standardParams = { ...base.standardParams, ...filterStandardParams(sampling, model) }

  let providerOptions = base.providerOptions
  if (callOverrides.providerOptions) {
    const merged: ProviderOptions = { ...providerOptions }
    for (const [pid, opts] of Object.entries(callOverrides.providerOptions)) {
      merged[pid] = { ...merged[pid], ...opts }
    }
    providerOptions = merged
  }
  return { standardParams, providerOptions }
}

/** Mirrors the AI SDK / `ToolLoopAgent` default step cap (`stepCountIs(20)`). Used as the fallback
 *  bound when a feature contributes a `stopWhen` but no assistant base supplies one — passing any
 *  explicit `stopWhen` otherwise suppresses the SDK default and leaves the tool loop uncapped. */
const SDK_DEFAULT_STEP_COUNT = 20

/**
 * OR the assistant's step cap with feature-contributed stop conditions. An explicit `stopWhen`
 * suppresses the loop's default `stepCountIs(20)`, so when a feature contributes a condition but no
 * assistant base supplies a cap, fall back to that default — otherwise an assistant-less tool loop
 * (e.g. a `chatId`-only steer-yield request) would run unbounded.
 */
export function composeStopWhen(
  baseStopWhen: StopCondition<ToolSet> | undefined,
  featureStopConditions: StopCondition<ToolSet>[]
): StopCondition<ToolSet> | StopCondition<ToolSet>[] | undefined {
  if (featureStopConditions.length === 0) return baseStopWhen
  const base = baseStopWhen ?? stepCountIs(SDK_DEFAULT_STEP_COUNT)
  return [base, ...featureStopConditions]
}

export function resolveToolCallLimit(assistant: Assistant | undefined): number {
  if (!assistant) return SDK_DEFAULT_STEP_COUNT

  const enableMaxToolCalls = assistant.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls
  if (!enableMaxToolCalls) {
    return DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
  }
  const raw = assistant.settings?.maxToolCalls
  const valid = raw !== undefined && raw >= MIN_TOOL_CALLS && raw <= MAX_TOOL_CALLS
  return valid ? raw : DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
}
