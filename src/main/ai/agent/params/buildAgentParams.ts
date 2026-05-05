import type { AiPlugin } from '@cherrystudio/ai-core'
import { MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@shared/config/constants'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { stepCountIs, type ToolSet } from 'ai'

import { extractAgentSessionId, isAgentSessionTopic } from '../../provider/claudeCodeSettingsBuilder'
import { providerToAiSdkConfig } from '../../provider/config'
import { getAiSdkProviderId } from '../../provider/factory'
import type { RequestContext } from '../../tools/context'
import { applyDeferExposition } from '../../tools/exposition/applyDeferExposition'
import { syncMcpToolsToRegistry } from '../../tools/mcp/mcpTools'
import { resolveAssistantMcpToolIds } from '../../tools/mcp/resolveAssistantMcpTools'
import { registry } from '../../tools/registry'
import { createAiRepair } from '../../tools/repair'
import type { ToolEntry } from '../../tools/types'
import type { AiBaseRequest } from '../../types/requests'
import {
  buildCapabilityProviderOptions,
  extractAiSdkStandardParams,
  mergeCustomProviderParameters
} from '../../utils/options'
import { getCustomParameters } from '../../utils/reasoning'
import type { AgentLoopHooks, AgentOptions } from '../loop'
import { assembleSystemPrompt } from './assembleSystemPrompt'
import { buildTelemetry } from './buildTelemetry'
import { resolveCapabilities } from './capabilities'
import { collectFromFeatures } from './collectFromFeatures'
import type { RequestFeature } from './feature'
import { INTERNAL_FEATURES } from './features'
import type { RequestScope, SdkConfig } from './scope'

export interface BuildAgentParamsInput {
  request: AiBaseRequest & {
    chatId?: string
    messageId?: string
  }
  signal: AbortSignal | undefined
  provider: Provider
  model: Model
  assistant?: Assistant
  /** Caller-supplied features merged after `INTERNAL_FEATURES`. */
  extraFeatures?: readonly RequestFeature[]
}

export interface BuiltAgentParams {
  sdkConfig: SdkConfig
  tools: ToolSet | undefined
  plugins: AiPlugin<any, any>[]
  system: string | undefined
  options: AgentOptions
  /** Hook contributions from features — caller composes with its own internal hooks. */
  hookParts: ReadonlyArray<Partial<AgentLoopHooks>>
}

export async function buildAgentParams(input: BuildAgentParamsInput): Promise<BuiltAgentParams> {
  const { request, signal, provider, model, assistant, extraFeatures } = input

  const sdkConfig = await resolveSdkConfig(provider, model, request.chatId)
  const { tools, deferredEntries, mcpToolIds } = await resolveTools(request, assistant, model)
  const capabilities = assistant ? resolveCapabilities(model, provider, assistant) : undefined

  const requestContext: RequestContext = {
    requestId: request.messageId ?? crypto.randomUUID(),
    topicId: request.chatId,
    assistant,
    abortSignal: signal
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
    requestContext,
    mcpToolIds
  }

  const features = extraFeatures?.length ? [...INTERNAL_FEATURES, ...extraFeatures] : INTERNAL_FEATURES
  const contributions = collectFromFeatures(scope, features)

  const system = await assembleSystemPrompt({ assistant, model, tools, deferredEntries })
  const options = buildAgentOptions(scope)

  return {
    sdkConfig,
    tools,
    plugins: contributions.modelAdapters,
    system,
    options,
    hookParts: contributions.hookParts
  }
}

/** sdkConfig with optional Claude Code agent-session id derived from chatId. */
async function resolveSdkConfig(provider: Provider, model: Model, chatId: string | undefined): Promise<SdkConfig> {
  const agentSessionId = chatId && isAgentSessionTopic(chatId) ? extractAgentSessionId(chatId) : undefined
  return {
    ...(await providerToAiSdkConfig(provider, model, { agentSessionId })),
    modelId: model.apiModelId ?? model.id
  }
}

/**
 * Tool selection: pick MCP ids (caller wins, else derived from assistant),
 * sync the MCP entries into the registry, then materialise the active
 * `ToolSet` via `applies` predicates and defer exposition.
 */
async function resolveTools(
  request: BuildAgentParamsInput['request'],
  assistant: Assistant | undefined,
  model: Model
): Promise<{
  tools: ToolSet | undefined
  deferredEntries: ToolEntry[]
  mcpToolIds: ReadonlySet<string>
}> {
  let mcpIdList = request.mcpToolIds
  if (!mcpIdList && request.assistantId) {
    mcpIdList = await resolveAssistantMcpToolIds(request.assistantId)
  }
  if (mcpIdList?.length) {
    await syncMcpToolsToRegistry()
  }
  const mcpToolIds = new Set(mcpIdList ?? [])

  const activeEntries = registry.selectActive({ assistant, mcpToolIds })
  let tools: ToolSet | undefined
  if (activeEntries.length > 0) {
    tools = {}
    for (const entry of activeEntries) tools[entry.name] = entry.tool
  }
  const exposed = applyDeferExposition(tools, registry, model.contextWindow)
  return { tools: exposed.tools, deferredEntries: exposed.deferredEntries, mcpToolIds }
}

/**
 * Assemble `AgentOptions`: capability-driven providerOptions overlaid with
 * the user's customParameters (split into AI-SDK standard params vs
 * provider-scoped params), per-call headers/maxRetries, stop-after-N-tools,
 * and the tool-call repair function.
 */
function buildAgentOptions(scope: RequestScope): AgentOptions {
  const { assistant, capabilities, model, provider, sdkConfig, requestContext, request } = scope

  let providerOptions =
    assistant && capabilities ? buildCapabilityProviderOptions(assistant, model, provider, capabilities) : {}
  let standardParams: Partial<Record<string, unknown>> = {}
  if (assistant) {
    const customParams = getCustomParameters(assistant)
    if (Object.keys(customParams).length > 0) {
      const split = extractAiSdkStandardParams(customParams)
      standardParams = split.standardParams
      providerOptions = mergeCustomProviderParameters(
        providerOptions,
        split.providerParams,
        getAiSdkProviderId(provider)
      )
    }
  }

  const { headers, maxRetries } = request.requestOptions ?? {}
  const stopWhen = assistant ? resolveStopWhenForAssistant(assistant) : undefined
  const telemetry = buildTelemetry(scope)

  return {
    maxRetries: maxRetries ?? 0,
    ...(stopWhen && { stopWhen }),
    ...(headers && { headers }),
    ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
    ...(telemetry && { telemetry }),
    ...standardParams,
    context: requestContext,
    repairToolCall: createAiRepair({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId
    })
  }
}

function resolveStopWhenForAssistant(assistant: Assistant): ReturnType<typeof stepCountIs> {
  const enableMaxToolCalls = assistant.settings?.enableMaxToolCalls ?? DEFAULT_ASSISTANT_SETTINGS.enableMaxToolCalls
  if (!enableMaxToolCalls) {
    return stepCountIs(DEFAULT_ASSISTANT_SETTINGS.maxToolCalls)
  }
  const raw = assistant.settings?.maxToolCalls
  const valid = raw !== undefined && raw >= MIN_TOOL_CALLS && raw <= MAX_TOOL_CALLS
  const count = valid ? raw : DEFAULT_ASSISTANT_SETTINGS.maxToolCalls
  return stepCountIs(count)
}
