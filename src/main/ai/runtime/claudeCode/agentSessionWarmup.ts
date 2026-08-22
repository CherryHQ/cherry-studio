import { createHash } from 'node:crypto'

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { projectRuntimeReasoning, providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { CHERRY_FAST_MODE_HEADER, CHERRY_INTERNAL_REQUEST_TOKEN_HEADER } from '@main/ai/constants'
import {
  type AgentNotificationContext,
  resolveAgentNotificationContext,
  resolveLinkedNotifyChannel
} from '@main/ai/runtime/agentMcpServers'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import { encodeReasoningInvocation, resolveReasoningInvocation } from '@main/ai/utils/reasoningSerializers'
import { createAiUsagePricingSnapshot } from '@main/ai/utils/usageCapture'
import { getAppLanguage } from '@main/i18n'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { defaultAppHeaders } from '@main/utils/http'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { isVisionModel, supportsDynamicallyLoadedTools } from '@shared/utils/model'
import {
  isExternalCliProvider,
  isOllamaProvider,
  isSupportFastMode,
  OLLAMA_PLACEHOLDER_AUTH_TOKEN
} from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { getExtraHeaders } from '../../utils/provider'
import { gatewayStateTag, resolveApiGatewayRuntime } from '../agentApiGateway'
import type { AgentSessionUsageCapture } from '../types'
import {
  createAgentProxyEnvironmentFingerprint,
  isAgentProxyEnvironmentKey,
  mergeAgentLoopbackProxyBypass
} from './agentProxyEnvironment'
import type { WarmQueryRequest } from './ClaudeCodeWarmQueryManager'
import { isAnthropicOfficialHost, with1mSuffix } from './contextWindowSuffix'
import { createClaudeCodeQueryOptions } from './queryOptions'
import {
  buildClaudeCodeSessionSettings,
  buildSkillWhitelist,
  getClaudeCodeLoginShellEnvironment,
  type McpServerSnapshotMap
} from './settingsBuilder'
import type { ClaudeCodeSettings } from './types'

const logger = loggerService.withContext('agentSessionWarmup')

export interface ClaudeCodeAgentSessionQueryRequest extends WarmQueryRequest {
  connectionConfig: ConnectionConfig
  settings: ClaudeCodeSettings
  sdkModelId: string
  usageCapture: AgentSessionUsageCapture
}

interface RuntimeModelRef {
  providerId: string
  modelId: string
  apiModelId: string
  contextWindow?: number
  provider?: Provider
  model?: Model
}

interface ClaudeCodeRouteFacts {
  branch: 'external-cli' | 'gateway' | 'direct'
  baseUrl?: string
  /** Rotation-insensitive auth/header identity — see {@link WarmQueryRequest.credentialsFingerprint}. */
  credentialsFingerprint: string
  modelIds: {
    primary: string
    opus: string
    sonnet: string
    haiku: string
  }
  /**
   * Whether the primary model accepts dynamically-loaded tool declarations — the mechanism behind
   * the SDK's ToolSearch, which Cherry force-enables via `ENABLE_TOOL_SEARCH=auto`
   * (settingsBuilder). False means `mergeRuntimeSettings` must strip that env var, or providers
   * that reject the injected blocks (Moonshot's Anthropic endpoint on non-K3 models) fail every
   * turn with `400 Invalid request: tokenization failed`. Computed from the effective connection
   * model in `deriveRouteFacts`, not `agent.model` — a per-turn connection can override it.
   */
  toolSearchCompatible: boolean
  /** Configured model identities keyed by every SDK alias that can appear in `result.modelUsage`. */
  usageModels: Extract<AgentSessionUsageCapture, { owner: 'agent-sdk' }>['frozenModels']
}

interface ClaudeCodeRuntimeRoute extends ClaudeCodeRouteFacts {
  apiKey?: string
  customHeaders?: string | Readonly<Record<string, string>>
  usageCapture: AgentSessionUsageCapture
  internalRequestToken?: string
}

/** The gateway is local even when it binds a non-default loopback address such as 127.0.0.2. */
function gatewayBypassRule(route: Pick<ClaudeCodeRouteFacts, 'branch' | 'baseUrl'>): string | undefined {
  if (route.branch !== 'gateway' || !route.baseUrl) return undefined

  try {
    return new URL(route.baseUrl).hostname
  } catch {
    return undefined
  }
}

interface ConnectionMaterializationFacts {
  route: ClaudeCodeRouteFacts
  mcp: unknown[]
  skills: string[]
  notificationContext: AgentNotificationContext
  contextWindow: number | null
  maxOutputTokens: number | null
  proxyEnvironmentFingerprint: string
}

/**
 * Hash the sensitive material that identifies a route's auth, independent of which key rotation
 * happens to pick. Direct routes hash the provider's enabled key SET and custom headers (rotation
 * within the set is invisible; editing either input changes the fingerprint). Gateway routes hash
 * the stable per-install gateway key. External-cli routes have no key (subscription login) — constant.
 */
function resolveEffectiveAgentLanguage(agent: AgentEntity): string | null {
  const perAgent = agent.configuration?.language
  if (typeof perAgent === 'string' && perAgent.trim() !== '') {
    if (perAgent === 'auto') return null
    return perAgent
  }
  try {
    const global = application.get('PreferenceService').get('agent.language') as unknown as string | null
    if (typeof global === 'string' && global.trim() !== '' && global !== 'auto') return global
  } catch {
    // PreferenceService unavailable in some test harnesses
  }
  try {
    return getAppLanguage()
  } catch {
    return null
  }
}

function fingerprintCredentials(material: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...material].sort()))
    .digest('hex')
}

type CustomHeaderSource = string | Readonly<Record<string, string>> | undefined

/**
 * Serialize headers in the newline-delimited format consumed by Claude Code's
 * `ANTHROPIC_CUSTOM_HEADERS`. Later sources win case-insensitively, so provider
 * settings override Cherry's app attribution and inherited agent/shell headers.
 */
function mergeAnthropicCustomHeaders(...sources: CustomHeaderSource[]): string | undefined {
  const headers = new Map<string, { name: string; value: string }>()
  const setHeader = (rawName: string, rawValue: string) => {
    const name = rawName.trim()
    if (!name) return
    headers.set(name.toLowerCase(), { name, value: rawValue.trim() })
  }

  for (const source of sources) {
    if (!source) continue
    if (typeof source === 'string') {
      for (const line of source.split('\n')) {
        const separator = line.indexOf(':')
        if (separator < 0) continue
        setHeader(line.slice(0, separator), line.slice(separator + 1))
      }
      continue
    }
    for (const [name, value] of Object.entries(source)) {
      setHeader(name, value)
    }
  }

  if (headers.size === 0) return undefined
  return [...headers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { name, value }]) => `${name}: ${value}`)
    .join('\n')
}

function buildUsageModels(
  entries: Array<{ sdkModelId: string; ref: RuntimeModelRef }>
): Extract<AgentSessionUsageCapture, { owner: 'agent-sdk' }>['frozenModels'] {
  const byModelId = new Map<
    string,
    {
      apiModelId: string
      modelName: string | null
      pricingSnapshot: ReturnType<typeof createAiUsagePricingSnapshot>
      aliases: Set<string>
    }
  >()
  for (const { sdkModelId, ref } of entries) {
    const current = byModelId.get(ref.modelId) ?? {
      apiModelId: ref.apiModelId,
      modelName: ref.model?.name ?? ref.modelId,
      pricingSnapshot: createAiUsagePricingSnapshot(ref.model?.pricing),
      aliases: new Set<string>()
    }
    current.aliases.add(sdkModelId)
    current.aliases.add(ref.apiModelId)
    current.aliases.add(ref.modelId)
    byModelId.set(ref.modelId, current)
  }
  return [...byModelId].map(([modelId, snapshot]) => ({
    modelId,
    apiModelId: snapshot.apiModelId,
    modelName: snapshot.modelName,
    pricingSnapshot: snapshot.pricingSnapshot,
    aliases: [...snapshot.aliases]
  }))
}

function buildRebuildRouteFacts(routeFacts: ClaudeCodeRouteFacts) {
  return {
    ...routeFacts,
    usageModels: routeFacts.usageModels.map((usageModel) => ({
      ...usageModel,
      pricingSnapshot: usageModel.pricingSnapshot
        ? {
            ...usageModel.pricingSnapshot,
            // This records when usage attribution was materialized, not a spawn-time routing fact.
            capturedAt: undefined
          }
        : null
    }))
  }
}

/**
 * Normalized tool-policy facts — the boundary-reconcilable side of {@link ConnectionConfig}.
 * Permission mode can be applied to an idle running connection and newly disabled tools can be
 * applied mid-turn; `disabledTools` is also part of the rebuild signature because removing a
 * disabled tool must restore it to the subprocess model context, which the SDK cannot do live.
 */
export interface ToolPolicyFacts {
  permissionMode: string | null
  disabledTools: string[]
  mcps: string[]
}

export function toolPolicyFactsEqual(a: ToolPolicyFacts, b: ToolPolicyFacts): boolean {
  // Arrays are sorted at derivation, so JSON equality is order-insensitive here.
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Staleness identity of an agent-session runtime connection, derived read-only at connect time and
 * re-derived at reconcile time. `rebuildSignature` covers everything baked into the spawned
 * subprocess (route/env, cwd, prompt inputs, skills whitelist, MCP definitions, credential
 * fingerprint); `live` carries the hot-appliable facts, diffed per key by the connection's reconcile.
 *
 * NOTE: `agent.mcps` and `agent.disabledTools` feed BOTH groups on purpose — their policy-gating
 * side is live (snapshot update), but the spawned MCP/disallowed-tool sets are rebuild-only. An edit
 * therefore live-heals the gate and flags `rebuild` for the subprocess context.
 *
 * Spike result (SDK 0.3.185, why MCP servers are NOT a live key): `query.setMcpServers` manages a
 * separate "dynamically managed" server layer in the CLI — it cannot remove servers baked into the
 * spawn-time `options.mcpServers`, so MCP removal always needs a rebuild, and additions-only
 * hot-plug would force reconcile to track a baked-vs-dynamic split plus mcpToolMetadata /
 * toolPolicySnapshot sync. Rebuild-at-next-turn covers both directions with none of that; promote
 * additions to a live key later if the reconnect cost ever matters.
 */
export interface ConnectionConfig {
  rebuildSignature: string
  /** Per-field hashes used only to identify which spawn-frozen facts caused a rebuild. */
  rebuildFactFingerprints: Readonly<Record<string, string>>
  live: {
    toolPolicy: ToolPolicyFacts
  }
}

export type DeriveConnectionConfigResult = { ok: true; config: ConnectionConfig } | { ok: false; reason: 'unroutable' }

/**
 * Pure facts extractor for connection staleness — NOT a builder inversion. Reads the same inputs
 * the settings builder consumes and reduces them to a signature + live facts, WITHOUT touching the
 * builder's side effects: no workspace mkdir, no builtin-agent provisioning, no shared
 * tool-policy-snapshot update (mutating it here would make the permission applier think the SDK is
 * already in sync — forking local policy from the subprocess), no MCP instance construction, no
 * gateway start/key generation, no key-rotation advance.
 *
 * Discipline: any NEW input added to `buildClaudeCodeSessionSettings` /
 * `buildClaudeCodeQueryRequestForAgentSession` that changes the spawned subprocess's behavior must
 * be added to the facts below (or to {@link ToolPolicyFacts} if it becomes hot-appliable).
 *
 * Known limitation: MCP facts cover the DB server definitions, not the runtime-discovered tool
 * lists (reading those goes through the MCP client — not a pure read). Tool-list drift within an
 * unchanged definition does not flag staleness; policy gating still heals live via the snapshot.
 */
export async function deriveConnectionConfig(
  sessionId: string,
  connectionModelId?: UniqueModelId,
  reasoningEffort: ReasoningEffortOption = 'default',
  fastMode = false,
  selectedKnowledgeBaseIds: readonly string[] = []
): Promise<DeriveConnectionConfigResult> {
  const unroutable = { ok: false, reason: 'unroutable' } as const

  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId) return unroutable
  const agent = agentService.getAgent(session.agentId)
  if (!agent?.model) return unroutable
  try {
    return {
      ok: true,
      config: await deriveConnectionConfigFromSnapshot(
        session,
        agent,
        connectionModelId ?? agent.model,
        reasoningEffort,
        fastMode,
        selectedKnowledgeBaseIds,
        undefined
      )
    }
  } catch (error) {
    // Deleted provider/model rows — the connection cannot be rebuilt to a valid target, so it is
    // invalid rather than merely stale. A knowledge-scope change also routes here on every rebuild
    // check, so an unexpected throw (missing workspace, skill-whitelist I/O) would otherwise end the
    // turn as `paused` with no trace at all — log before swallowing.
    logger.warn('Failed to derive connection config; treating the connection as unroutable', {
      sessionId,
      error
    })
    return unroutable
  }
}

async function deriveAgentProxyEnvironmentFingerprint(
  agent: AgentEntity,
  route: ClaudeCodeRouteFacts
): Promise<string> {
  const proxyEnvironment = getProxyEnvironment(process.env)
  return createAgentProxyEnvironmentFingerprint(
    {
      ...(await getClaudeCodeLoginShellEnvironment(proxyEnvironment)),
      ...proxyEnvironment,
      ...agent.configuration?.env_vars
    },
    { additionalBypassRule: gatewayBypassRule(route) }
  )
}

async function deriveConnectionConfigFromSnapshot(
  session: AgentSessionEntity,
  agent: AgentEntity,
  uniqueModelId: UniqueModelId,
  reasoningEffort: ReasoningEffortOption,
  fastMode: boolean,
  selectedKnowledgeBaseIds: readonly string[] = [],
  materialized?: ConnectionMaterializationFacts
): Promise<ConnectionConfig> {
  const cwd = session.workspace?.path
  if (!cwd) throw new Error(`Agent session ${session.id} has no workspace path`)
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const contextWindow = materialized ? materialized.contextWindow : (model.contextWindow ?? null)
  const maxOutputTokens = materialized ? materialized.maxOutputTokens : (model.maxOutputTokens ?? null)
  const effectiveFastMode = fastMode && isSupportFastMode(provider, model)
  let routeFacts = materialized?.route
  if (!routeFacts) {
    const { baseUrl } = resolveEffectiveEndpoint(provider, model)
    // Same pinning semantics as the query-request builder (see its comment).
    const pinSubModelsToPrimary = uniqueModelId !== agent.model
    routeFacts = deriveRouteFacts(
      provider,
      model,
      modelId,
      baseUrl,
      pinSubModelsToPrimary ? undefined : agent.planModel,
      pinSubModelsToPrimary ? undefined : agent.smallModel
    )
  }
  const skills = materialized?.skills ?? (await buildSkillWhitelist(agent, cwd))
  const notificationContext = materialized?.notificationContext ?? resolveAgentNotificationContext(session.id, agent.id)
  const proxyEnvironmentFingerprint =
    materialized?.proxyEnvironmentFingerprint ?? (await deriveAgentProxyEnvironmentFingerprint(agent, routeFacts))
  const rebuildFacts = {
    modelId: uniqueModelId,
    contextWindow,
    maxOutputTokens,
    reasoningEffort,
    fastMode: effectiveFastMode,
    route: buildRebuildRouteFacts(routeFacts),
    cwd,
    language: resolveEffectiveAgentLanguage(agent),
    instructions: agent.instructions ?? null,
    // Persistent variable inputs rebuild the connection. Date/time variables intentionally remain
    // connection snapshots instead of invalidating this signature every turn.
    promptUserName: application.get('PreferenceService').get('app.user.name') || 'Unknown Username',
    promptModelName: agent.modelName || null,
    builtinRole: agent.configuration?.builtin_role ?? null,
    bootstrapCompleted: agent.configuration?.bootstrap_completed ?? null,
    skills: [...skills].sort(),
    envVars: Object.entries(agent.configuration?.env_vars ?? {})
      .filter(([key]) => !isAgentProxyEnvironmentKey(key))
      .sort(([a], [b]) => a.localeCompare(b)),
    proxyEnvironment: proxyEnvironmentFingerprint,
    disabledTools: [...(agent.disabledTools ?? [])].sort(),
    knowledgeBaseIds: resolveKnowledgeBaseScope(agent.knowledgeBaseIds, selectedKnowledgeBaseIds),
    mcp: materialized?.mcp ?? deriveMcpDefinitionFacts(agent.mcps),
    notificationContext
  }
  const rebuildFactFingerprints = Object.fromEntries(
    Object.entries(rebuildFacts).map(([name, value]) => [
      name,
      createHash('sha256')
        .update(JSON.stringify(value) ?? 'undefined')
        .digest('hex')
    ])
  )

  return {
    rebuildSignature: createHash('sha256').update(JSON.stringify(rebuildFacts)).digest('hex'),
    rebuildFactFingerprints,
    live: {
      toolPolicy: {
        permissionMode: agent.configuration?.permission_mode ?? null,
        disabledTools: [...(agent.disabledTools ?? [])].sort(),
        mcps: [...(agent.mcps ?? [])].sort()
      }
    }
  }
}

/** DB-definition facts for each referenced MCP server (read-only rows; no client connections). */
function deriveMcpDefinitionFacts(mcpIds: string[] | null | undefined, snapshots?: McpServerSnapshotMap): unknown[] {
  return [...(mcpIds ?? [])].sort().map((mcpId) => {
    const server = snapshots ? snapshots.get(mcpId) : mcpServerService.findByIdOrName(mcpId)
    if (!server) return { mcpId, missing: true }
    return {
      mcpId,
      id: server.id,
      name: server.name,
      type: server.type,
      command: server.command ?? null,
      args: server.args ?? null,
      baseUrl: server.baseUrl ?? null,
      env: Object.entries(server.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      headers: Object.entries(server.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))
    }
  })
}

function captureMcpServerSnapshots(mcpIds: string[] | null | undefined): McpServerSnapshotMap {
  const snapshots = new Map<string, McpServer | undefined>()
  for (const mcpId of mcpIds ?? []) {
    snapshots.set(mcpId, mcpServerService.findByIdOrName(mcpId))
  }
  return snapshots
}

export async function buildClaudeCodeQueryRequestForAgentSession(
  sessionId: string,
  effectiveResume?: string,
  /** Connection-scoped model override: a live turn runs on the model captured at its creation,
   *  which may differ from the agent's latest model after a mid-window edit. Defaults to the
   *  agent's current model (prewarm and turn-less connections). */
  connectionModelId?: UniqueModelId,
  /** Canonical reasoning selection frozen when the turn was submitted. */
  reasoningEffort: ReasoningEffortOption = 'default',
  /** Fast selection frozen when the turn was submitted. */
  fastMode = false,
  /** Composer knowledge selection frozen when the turn was submitted. */
  selectedKnowledgeBaseIds: readonly string[] = []
): Promise<ClaudeCodeAgentSessionQueryRequest | undefined> {
  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId) return undefined

  const agent = agentService.getAgent(session.agentId)
  if (!agent?.model) return undefined
  const linkedChannelSnapshot = resolveLinkedNotifyChannel(session.id, agent.id)
  const notificationContext = resolveAgentNotificationContext(session.id, agent.id, linkedChannelSnapshot)
  const mcpServerSnapshots = captureMcpServerSnapshots(agent.mcps)

  const uniqueModelId = connectionModelId ?? agent.model
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  // Freeze the model metadata that configures this subprocess. Re-reading it after async route,
  // settings, and skill materialization can otherwise make the baseline describe a different
  // compaction window from the one actually passed to Claude Code.
  const contextWindow = model.contextWindow
  const maxOutputTokens = model.maxOutputTokens
  const fastModeTransport = fastMode && isSupportFastMode(provider, model) ? provider.fastMode.transport : undefined
  const thinkingOptions = resolveClaudeCodeThinkingOptions(model, reasoningEffort)
  const { baseUrl } = resolveEffectiveEndpoint(provider, model)
  // A live turn's connection is pinned to the model captured at turn creation, which can already be an
  // edit behind `agent.model`. The turn captured only its primary, so when the primary is a pre-edit
  // capture (the effective model differs from the latest `agent.model`), pin plan/small to it too rather
  // than read the possibly-edited-ahead latest sub-models — otherwise the captured turn would launch with
  // the old ANTHROPIC_MODEL but new sonnet/haiku defaults, or be forced onto the gateway by a sub-model
  // that now points at another provider. With no edit (or a turn-less connection) the latest sub-models
  // still apply.
  const pinSubModelsToPrimary = uniqueModelId !== agent.model
  const planModel = pinSubModelsToPrimary ? undefined : agent.planModel
  const smallModel = pinSubModelsToPrimary ? undefined : agent.smallModel
  const route = await resolveClaudeCodeRuntimeRoute(
    session.id,
    provider,
    model,
    modelId,
    baseUrl,
    planModel,
    smallModel,
    {
      type: 'agent',
      id: agent.id,
      name: agent.name ?? null,
      icon: agent.configuration?.avatar ?? null
    }
  )
  const resumeSessionId =
    effectiveResume ?? agentSessionMessageService.getLastRuntimeResumeToken(session.id) ?? undefined
  const settings = mergeRuntimeSettings(
    await buildClaudeCodeSessionSettings(
      session,
      provider,
      {
        contextWindow,
        maxOutputTokens,
        lastAgentSessionId: resumeSessionId,
        mcpServerSnapshots,
        linkedChannelSnapshot,
        notificationContext,
        knowledgeBaseIds: selectedKnowledgeBaseIds,
        supportsImages: Array.isArray(model.capabilities) && isVisionModel(model),
        thinkingOptions,
        fastMode: fastModeTransport === 'claude-code'
      },
      agent
    ),
    route,
    fastModeTransport
  )
  // Capture the baseline from the exact route, MCP rows, agent snapshot, and skill list that
  // materialized this request. This runs after route materialization so a first-use gateway key is
  // already persisted and the connect-time fingerprint matches later pure reconciles.
  const connectionConfig = await deriveConnectionConfigFromSnapshot(
    session,
    agent,
    uniqueModelId,
    reasoningEffort,
    fastMode,
    selectedKnowledgeBaseIds,
    {
      route: toConnectionRouteFacts(route),
      mcp: deriveMcpDefinitionFacts(agent.mcps, mcpServerSnapshots),
      skills: settings.skills ?? [],
      notificationContext,
      contextWindow: contextWindow ?? null,
      maxOutputTokens: maxOutputTokens ?? null,
      proxyEnvironmentFingerprint: createAgentProxyEnvironmentFingerprint(settings.env ?? {}, {
        additionalBypassRule: gatewayBypassRule(route)
      })
    }
  )
  const sdkModelId = route.modelIds.primary
  const options = createClaudeCodeQueryOptions({
    modelId: sdkModelId,
    settings,
    effectiveResume: resumeSessionId ?? settings.resume
  })

  if (options.includePartialMessages === undefined) {
    options.includePartialMessages = true
  }

  return {
    connectionConfig,
    key: settings.warmQueryKey ?? session.id,
    options,
    initializeTimeoutMs: settings.warmQueryInitializeTimeoutMs,
    notificationContext,
    credentialsFingerprint: route.credentialsFingerprint,
    knowledgeBaseIds: resolveKnowledgeBaseScope(agent.knowledgeBaseIds, selectedKnowledgeBaseIds),
    settings,
    sdkModelId,
    usageCapture: route.usageCapture
  }
}

/**
 * Claude Agent SDK always speaks the Anthropic-native reasoning dialect. When its route points at
 * Cherry's gateway, the gateway translates those native fields again for the target endpoint.
 */
function resolveClaudeCodeThinkingOptions(
  model: Model,
  reasoningEffort: ReasoningEffortOption
): { effort?: Options['effort']; thinking?: Options['thinking'] } {
  const profile = providerRegistryService.resolveReasoningProfile(
    {
      id: 'anthropic',
      presetProviderId: 'anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    },
    model,
    ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  )
  const invocationModel = profile.support
    ? { ...model, reasoning: projectRuntimeReasoning(profile.support, profile.wire) }
    : model
  const invocation = resolveReasoningInvocation({
    selection: reasoningEffort,
    model: invocationModel,
    profile: profile.wire,
    maxTokens: model.maxOutputTokens
  })
  const encoded = encodeReasoningInvocation(invocation)

  return {
    effort: encoded.effort as Options['effort'] | undefined,
    thinking: encoded.thinking as Options['thinking'] | undefined
  }
}

/**
 * Pure (read-only) half of the route resolution: branch decision, model-id slots, baseUrl and the
 * credentials fingerprint — everything the staleness signature needs. MUST stay side-effect free:
 * no `resolveApiKey` (advances rotation), no gateway `ensureValidApiKey` (persists a key on
 * first use) or `start()` (boots the HTTP server). Credential *values* are materialized by
 * {@link resolveClaudeCodeRuntimeRoute} only when a query (warm or live) is materialized.
 */
function deriveRouteFacts(
  primaryProvider: Provider,
  primaryModel: Model,
  primaryModelId: string,
  primaryBaseUrl: string,
  planModel: UniqueModelId | null | undefined,
  smallModel: UniqueModelId | null | undefined
): ClaudeCodeRouteFacts {
  const primaryRef: RuntimeModelRef = {
    providerId: primaryProvider.id,
    modelId: primaryModelId,
    apiModelId: primaryModel.apiModelId ?? primaryModelId,
    contextWindow: primaryModel.contextWindow,
    provider: primaryProvider,
    model: primaryModel
  }
  const opusRef = primaryRef
  // Unset plan/small models fall back to `primaryRef` (the effective connection model). The caller also
  // passes them unset to pin a captured turn's route to its primary (see `pinSubModelsToPrimary`), so a
  // mid-window sub-model edit can't mix into the captured connection — the whole route stays on the pinned
  // model (consistent env values, no spurious gateway switch when the edit points at another provider).
  const sonnetRef = resolveRuntimeModelRef(planModel, primaryRef)
  const haikuRef = resolveRuntimeModelRef(smallModel, primaryRef)
  const modelRefs = [primaryRef, opusRef, sonnetRef, haikuRef]

  // ToolSearch is gated on the *primary* model only: it is the only one that can emit ToolSearch
  // calls, and every dynamically-loaded tool declaration lands in the shared conversation the
  // primary model must parse. Sub-models are pinned to the primary whenever they differ from
  // `agent.model` (see `pinSubModelsToPrimary`), so keying on the primary never misses a
  // per-turn model override.
  const toolSearchCompatible = supportsDynamicallyLoadedTools(primaryRef.apiModelId)

  // External-cli (e.g. claude-code) authenticates only through the SDK's
  // subscription login, which can serve *only* this provider's own models. A
  // plan/small model pointing at another provider can't run on that login — and
  // must not fall through to the gateway branch below, which would inject an API
  // key (abandoning the login) and ship an unresolvable `claude-code:*` id to
  // the gateway, bricking the agent. Pin every sub-model back onto the primary
  // so the agent still runs on the subscription login.
  if (isExternalCliProvider(primaryProvider)) {
    const pinToPrimary = (ref: RuntimeModelRef) => (ref.providerId === primaryProvider.id ? ref : primaryRef)
    const externalRefs = {
      primary: primaryRef,
      opus: primaryRef,
      sonnet: pinToPrimary(sonnetRef),
      haiku: pinToPrimary(haikuRef)
    }
    const modelIds = {
      primary: externalRefs.primary.apiModelId,
      opus: externalRefs.opus.apiModelId,
      sonnet: externalRefs.sonnet.apiModelId,
      haiku: externalRefs.haiku.apiModelId
    }
    return {
      branch: 'external-cli',
      credentialsFingerprint: 'external-cli',
      toolSearchCompatible,
      modelIds,
      usageModels: buildUsageModels([
        { sdkModelId: modelIds.primary, ref: externalRefs.primary },
        { sdkModelId: modelIds.opus, ref: externalRefs.opus },
        { sdkModelId: modelIds.sonnet, ref: externalRefs.sonnet },
        { sdkModelId: modelIds.haiku, ref: externalRefs.haiku }
      ])
    }
  }

  const shouldUseGateway = modelRefs.some(
    (ref) => ref.providerId !== primaryProvider.id || !usesAnthropicMessagesEndpoint(ref)
  )

  if (shouldUseGateway) {
    const apiGatewayService = application.get('ApiGatewayService')
    const config = apiGatewayService.getCurrentConfig()
    const host = config.host || '127.0.0.1'
    const port = config.port || 23333
    // Fingerprint the persisted gateway key WITHOUT `ensureValidApiKey` (which would generate and
    // persist one). Before the gateway's first activation the preference is empty — the signature
    // changes once when the key is generated, costing a single extra rebuild. Accepted.
    const gatewayKey = application.get('PreferenceService').get('feature.api_gateway.api_key')
    return {
      branch: 'gateway',
      baseUrl: gatewayClientOrigin(host, port),
      credentialsFingerprint: fingerprintCredentials([
        typeof gatewayKey === 'string' ? gatewayKey : '',
        gatewayStateTag(config.enabled, apiGatewayService.isRunning())
      ]),
      toolSearchCompatible,
      modelIds: {
        primary: toGatewayModelId(primaryRef),
        opus: toGatewayModelId(opusRef),
        sonnet: toGatewayModelId(sonnetRef),
        haiku: toGatewayModelId(haikuRef)
      },
      usageModels: []
    }
  }

  const anthropicBaseUrl = resolveAnthropicBaseUrl(primaryProvider, primaryBaseUrl)
  // Fingerprint the enabled key SET (read-only), not the rotated pick — so prewarm/consume builds
  // that rotate onto different keys still sign identically. Include request headers because they
  // are also fixed at subprocess spawn; editing either input invalidates warm reuse.
  const enabledKeys = providerService.getApiKeys(primaryProvider.id, { enabled: true }).map((entry) => entry.key)
  const customHeaders = mergeAnthropicCustomHeaders(defaultAppHeaders(), getExtraHeaders(primaryProvider))
  // Every slot resolves to the same `anthropicBaseUrl`, so one host check gates them all. Decide
  // first-party by resolved host, NOT preset origin: a provider copied from the Anthropic preset but
  // repointed at a custom 1M proxy is not first-party and must still get the `[1m]` suffix.
  const isAnthropicNative = isAnthropicOfficialHost(anthropicBaseUrl)
  const modelIds = {
    primary: with1mSuffix(primaryRef.apiModelId, primaryRef.contextWindow, isAnthropicNative),
    opus: with1mSuffix(opusRef.apiModelId, opusRef.contextWindow, isAnthropicNative),
    sonnet: with1mSuffix(sonnetRef.apiModelId, sonnetRef.contextWindow, isAnthropicNative),
    haiku: with1mSuffix(haikuRef.apiModelId, haikuRef.contextWindow, isAnthropicNative)
  }
  return {
    branch: 'direct',
    baseUrl: anthropicBaseUrl,
    credentialsFingerprint: fingerprintCredentials([
      ...enabledKeys.map((key) => `api-key:${key}`),
      ...(customHeaders ? [`custom-headers:${customHeaders}`] : [])
    ]),
    toolSearchCompatible,
    modelIds,
    usageModels: buildUsageModels([
      { sdkModelId: modelIds.primary, ref: primaryRef },
      { sdkModelId: modelIds.opus, ref: opusRef },
      { sdkModelId: modelIds.sonnet, ref: sonnetRef },
      { sdkModelId: modelIds.haiku, ref: haikuRef }
    ])
  }
}

/** Effectful half: materializes the credentials for the branch {@link deriveRouteFacts} picked. */
async function resolveClaudeCodeRuntimeRoute(
  sessionId: string,
  primaryProvider: Provider,
  primaryModel: Model,
  primaryModelId: string,
  primaryBaseUrl: string,
  planModel: UniqueModelId | null | undefined,
  smallModel: UniqueModelId | null | undefined,
  source: SourceSnapshot
): Promise<ClaudeCodeRuntimeRoute> {
  const facts = deriveRouteFacts(primaryProvider, primaryModel, primaryModelId, primaryBaseUrl, planModel, smallModel)

  switch (facts.branch) {
    case 'external-cli':
      return {
        ...facts,
        usageCapture: {
          owner: 'agent-sdk',
          credentialReceipt: { attribution: 'auth', method: 'external-cli' },
          providerId: primaryProvider.id,
          providerName: primaryProvider.name ?? null,
          source,
          frozenModels: facts.usageModels
        }
      }
    case 'gateway': {
      const gateway = await resolveApiGatewayRuntime(sessionId)
      return {
        ...facts,
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
        customHeaders: gateway.usageHeaders,
        usageCapture: { owner: 'provider-calls' },
        internalRequestToken: gateway.internalRequestToken,
        credentialsFingerprint: fingerprintCredentials([gateway.apiKey, gateway.stateTag])
      }
    }
    case 'direct': {
      const resolvedApiKey = providerService.resolveApiKey(primaryProvider.id)
      const runtimeApiKey =
        resolvedApiKey.value || (isOllamaProvider(primaryProvider) ? OLLAMA_PLACEHOLDER_AUTH_TOKEN : '')
      return {
        ...facts,
        apiKey: runtimeApiKey,
        customHeaders: mergeAnthropicCustomHeaders(defaultAppHeaders(), getExtraHeaders(primaryProvider)),
        usageCapture: {
          owner: 'agent-sdk',
          credentialReceipt: resolvedApiKey.apiKeySelection,
          providerId: primaryProvider.id,
          providerName: primaryProvider.name ?? null,
          source,
          frozenModels: facts.usageModels
        },
        credentialsFingerprint: facts.credentialsFingerprint
      }
    }
  }
}

function toConnectionRouteFacts(route: ClaudeCodeRuntimeRoute): ClaudeCodeRouteFacts {
  return {
    branch: route.branch,
    baseUrl: route.baseUrl,
    credentialsFingerprint: route.credentialsFingerprint,
    toolSearchCompatible: route.toolSearchCompatible,
    modelIds: route.modelIds,
    usageModels: route.usageModels
  }
}

function resolveRuntimeModelRef(
  uniqueModelId: UniqueModelId | null | undefined,
  fallback: RuntimeModelRef
): RuntimeModelRef {
  if (!uniqueModelId) return fallback
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  if (providerId === fallback.providerId && modelId === fallback.modelId) return fallback

  try {
    let provider: ReturnType<typeof providerService.getByProviderId> | undefined
    try {
      provider = providerService.getByProviderId(providerId)
    } catch {
      provider = undefined
    }
    let model: ReturnType<typeof modelService.getByKey> | undefined
    try {
      model = modelService.getByKey(providerId, modelId)
    } catch {
      model = undefined
    }
    return {
      providerId,
      modelId,
      apiModelId: model?.apiModelId ?? modelId,
      contextWindow: model?.contextWindow,
      provider,
      model
    }
  } catch {
    return { providerId, modelId, apiModelId: modelId }
  }
}

/**
 * The Claude Agent SDK only ever speaks Anthropic Messages, so the direct route asks the shared
 * resolver for that dialect instead of taking the in-app-chat default (`endpointTypes[0]`). A model
 * that declares `anthropic-messages` behind another dialect — DeepSeek V4 Flash lists it third — would
 * otherwise be pushed onto the gateway, which re-serializes the SDK's native thinking blocks into a
 * dialect that cannot carry them back. The resolver declines the preference when the model does not
 * declare the endpoint or the provider configures no base URL for it, which this comparison detects.
 */
function usesAnthropicMessagesEndpoint(ref: RuntimeModelRef): boolean {
  if (!ref.provider || !ref.model) return false
  return (
    resolveEffectiveEndpoint(ref.provider, ref.model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES).endpointType ===
    ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  )
}

function toGatewayModelId(ref: RuntimeModelRef): string {
  return formatGatewayModelId(ref.providerId, ref.apiModelId)
}

function resolveAnthropicBaseUrl(provider: Provider, baseUrl: string) {
  // Claude SDK manages API versioning itself — ANTHROPIC_BASE_URL must not include /v1.
  const anthropicEndpointUrl = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  const rawBaseUrl = anthropicEndpointUrl || baseUrl
  return rawBaseUrl ? withoutTrailingApiVersion(formatApiHost(rawBaseUrl, false)) : undefined
}

function mergeRuntimeSettings(
  settings: ClaudeCodeSettings,
  route: ClaudeCodeRuntimeRoute,
  fastModeTransport?: NonNullable<Provider['fastMode']>['transport']
): ClaudeCodeSettings {
  const fastModeHeaders =
    route.branch === 'gateway' && fastModeTransport === 'openai-priority' && route.internalRequestToken
      ? `${CHERRY_FAST_MODE_HEADER}: true\n${CHERRY_INTERNAL_REQUEST_TOKEN_HEADER}: ${route.internalRequestToken}`
      : undefined
  const customHeaders = mergeAnthropicCustomHeaders(
    settings.env?.ANTHROPIC_CUSTOM_HEADERS,
    route.customHeaders,
    fastModeHeaders
  )
  const env = mergeAgentLoopbackProxyBypass(
    {
      ...settings.env,
      ANTHROPIC_MODEL: route.modelIds.primary,
      ANTHROPIC_DEFAULT_OPUS_MODEL: route.modelIds.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: route.modelIds.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: route.modelIds.haiku,
      ...(route.apiKey ? { ANTHROPIC_API_KEY: route.apiKey, ANTHROPIC_AUTH_TOKEN: route.apiKey } : {}),
      ...(route.baseUrl ? { ANTHROPIC_BASE_URL: route.baseUrl } : {}),
      ...(customHeaders ? { ANTHROPIC_CUSTOM_HEADERS: customHeaders } : {})
    },
    { additionalBypassRule: gatewayBypassRule(route) }
  )
  // `buildEnvironment` force-enables the SDK's ToolSearch via `ENABLE_TOOL_SEARCH=auto` before the
  // per-turn model is known, and the var is in the blocked list so agents cannot override it. When
  // the effective connection model rejects dynamically-loaded tool declarations (e.g. Kimi models
  // other than K3 on Moonshot's Anthropic endpoint → `400 Invalid request: tokenization failed`),
  // drop it here so the SDK falls back to loading every tool upfront.
  if (!route.toolSearchCompatible) {
    delete env.ENABLE_TOOL_SEARCH
  }
  return {
    ...settings,
    env
  }
}

export async function buildClaudeCodeWarmQueryRequestForAgentSession(
  sessionId: string
): Promise<WarmQueryRequest | undefined> {
  const request = await buildClaudeCodeQueryRequestForAgentSession(sessionId)
  if (!request) return undefined
  return {
    key: request.key,
    options: request.options,
    initializeTimeoutMs: request.initializeTimeoutMs,
    credentialsFingerprint: request.credentialsFingerprint,
    usageCapture: request.usageCapture,
    knowledgeBaseIds: request.knowledgeBaseIds,
    notificationContext: request.notificationContext
  }
}
