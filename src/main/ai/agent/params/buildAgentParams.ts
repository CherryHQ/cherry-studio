import { application } from '@application'
import type { AiPlugin } from '@cherrystudio/ai-core'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { topicService } from '@main/data/services/TopicService'
import { MAX_TOOL_CALLS, MIN_TOOL_CALLS } from '@shared/config/constants'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import {
  type ContextSettingsOverride,
  DEFAULT_CONTEXT_SETTINGS,
  type EffectiveContextSettings
} from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { stepCountIs, type ToolSet } from 'ai'

import { resolveCompressionModel } from '../../contextChef/resolveCompressionModel'
import { resolveContextSettings } from '../../contextChef/resolveContextSettings'
import { extractAgentSessionId, isAgentSessionTopic } from '../../provider/claudeCodeSettingsBuilder'
import { providerToAiSdkConfig } from '../../provider/config'
import { getAiSdkProviderId } from '../../provider/factory'
import { toolsetCache } from '../../stream-manager/toolsetCache'
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
  const workspaceRoot = await resolveTopicWorkspaceRoot(request.chatId)

  // Three-layer context-settings resolution: globals (prefs) <- assistant
  // override <- topic override. `compress.modelId` further falls back to
  // the user's topic-naming model. See `resolveContextSettings` docs.
  const contextSettings = await resolveRequestContextSettings(assistant, request.chatId)

  // Pre-resolve the compression model so chef's `compress.model` slot
  // gets a `LanguageModelV3` instance, not a triple. Goes through the
  // same `createExecutor → languageModel` path the agent uses, so
  // resolution rules stay symmetric. `null` here means chef will skip
  // LLM compression and fall back to onBeforeCompress sliding-window
  // drop in the contextBuild feature wiring.
  const compressionModel =
    contextSettings.enabled && contextSettings.compress.enabled && contextSettings.compress.modelId
      ? await resolveCompressionModel(contextSettings.compress.modelId)
      : null

  const requestContext: RequestContext = {
    requestId: request.messageId ?? crypto.randomUUID(),
    topicId: request.chatId,
    assistantMessageId: request.messageId,
    assistant,
    provider,
    model,
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
    mcpToolIds,
    workspaceRoot,
    contextSettings,
    compressionModel
  }

  const features = extraFeatures?.length ? [...INTERNAL_FEATURES, ...extraFeatures] : INTERNAL_FEATURES
  const contributions = collectFromFeatures(scope, features)

  const system = await assembleSystemPrompt({
    assistant,
    model,
    provider,
    workspaceRoot,
    contextSettings,
    tools,
    deferredEntries
  })
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

  // Per-topic toolset cache: when the user's tool-affecting settings haven't
  // shifted between turns, reuse the same `ToolSet` reference so Anthropic's
  // prompt prefix cache stays warm. Signature-based: a settings change
  // mid-conversation transparently invalidates and rebuilds.
  const cachedTools = toolsetCache.resolve({ assistant, mcpToolIds }, request.chatId, registry)
  const tools: ToolSet | undefined = Object.keys(cachedTools).length > 0 ? cachedTools : undefined
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

/**
 * Resolve the workspace root bound to a topic, checking the in-memory
 * temporary-chat store first (covers brand-new topics where the user
 * picked a folder before the first message persisted) and falling back
 * to the SQLite topic row.
 */
async function resolveTopicWorkspaceRoot(topicId: string | undefined): Promise<string | null> {
  if (!topicId) return null
  const temp = temporaryChatService.getTopic(topicId)
  if (temp) return temp.workspaceRoot ?? null
  const persisted = await topicService.getWorkspaceRoot(topicId)
  return persisted ?? null
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

/**
 * Read globals from preferences, fetch per-topic override, and collapse
 * the three layers via `resolveContextSettings`. Topic fetch failures
 * (e.g. transient temp-chat with no DB row) degrade silently to
 * "no topic override".
 */
async function resolveRequestContextSettings(
  assistant: Assistant | undefined,
  chatId: string | undefined
): Promise<EffectiveContextSettings> {
  const prefs = application.get('PreferenceService')
  const globals: EffectiveContextSettings = {
    enabled: prefs.get('chat.context_settings.enabled'),
    truncateThreshold: prefs.get('chat.context_settings.truncate_threshold'),
    compress: {
      enabled: prefs.get('chat.context_settings.compress.enabled'),
      modelId: prefs.get('chat.context_settings.compress.model_id')
    }
  }
  const topicNamingModelId = prefs.get('topic.naming.model_id')

  let topic: ContextSettingsOverride | null | undefined
  if (chatId) {
    try {
      const t = await topicService.getById(chatId)
      topic = t.contextSettings ?? undefined
    } catch {
      // Topic not yet persisted (temp chat) or other lookup failure —
      // treat as no override; assistant + globals still apply.
      topic = undefined
    }
  }

  return resolveContextSettings({
    assistant: assistant?.settings?.contextSettings,
    topic,
    globals: {
      enabled: globals.enabled ?? DEFAULT_CONTEXT_SETTINGS.enabled,
      truncateThreshold: globals.truncateThreshold ?? DEFAULT_CONTEXT_SETTINGS.truncateThreshold,
      compress: {
        enabled: globals.compress.enabled ?? DEFAULT_CONTEXT_SETTINGS.compress.enabled,
        modelId: globals.compress.modelId ?? DEFAULT_CONTEXT_SETTINGS.compress.modelId
      }
    },
    topicNamingModelId
  })
}
