import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { isExternalCliProvider, isOllamaProvider, OLLAMA_PLACEHOLDER_AUTH_TOKEN } from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import type { WarmQueryRequest } from './ClaudeCodeWarmQueryManager'
import { withDeepSeek1mSuffix } from './deepseekContext'
import { createClaudeCodeQueryOptions } from './queryOptions'
import { buildClaudeCodeSessionSettings, buildSkillWhitelist, type McpServerSnapshotMap } from './settingsBuilder'
import type { ClaudeCodeSettings } from './types'

export interface ClaudeCodeAgentSessionQueryRequest extends WarmQueryRequest {
  connectionConfig: ConnectionConfig
  settings: ClaudeCodeSettings
  sdkModelId: string
}

interface RuntimeModelRef {
  providerId: string
  modelId: string
  apiModelId: string
  provider?: Provider
}

interface ClaudeCodeRouteFacts {
  branch: 'external-cli' | 'gateway' | 'direct'
  baseUrl?: string
  /** Rotation-insensitive credential identity — see {@link WarmQueryRequest.credentialsFingerprint}. */
  credentialsFingerprint: string
  modelIds: {
    primary: string
    opus: string
    sonnet: string
    haiku: string
  }
}

interface ClaudeCodeRuntimeRoute extends ClaudeCodeRouteFacts {
  apiKey?: string
}

interface ConnectionMaterializationFacts {
  route: ClaudeCodeRouteFacts
  mcp: unknown[]
  skills: string[]
  linkedChannelId: string | null
}

/**
 * Hash the credential material that identifies a route's auth, independent of which key rotation
 * happens to pick. Direct routes hash the provider's enabled key SET (rotation within the set is
 * invisible; adding/removing/disabling a key changes the fingerprint). Gateway routes hash the
 * stable per-install gateway key. External-cli routes have no key (subscription login) — constant.
 */
function fingerprintCredentials(material: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...material].sort()))
    .digest('hex')
}

/**
 * Normalized tool-policy facts — the immediately enforceable side of {@link ConnectionConfig}.
 * Permission mode and newly disabled tools can be applied to a running connection; `disabledTools`
 * is also part of the rebuild signature because removing a disabled tool must restore it to the
 * subprocess model context, which the SDK cannot do live.
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
 * subprocess (route/env, cwd, prompt inputs, skills whitelist, maxTurns, MCP definitions, credential
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
  connectionModelId?: UniqueModelId
): Promise<DeriveConnectionConfigResult> {
  const unroutable = { ok: false, reason: 'unroutable' } as const

  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId) return unroutable
  const agent = agentService.getAgent(session.agentId)
  if (!agent?.model) return unroutable
  try {
    return {
      ok: true,
      config: await deriveConnectionConfigFromSnapshot(session, agent, connectionModelId ?? agent.model)
    }
  } catch {
    // Deleted provider/model rows — the connection cannot be rebuilt to a valid target, so it is
    // invalid rather than merely stale.
    return unroutable
  }
}

async function deriveConnectionConfigFromSnapshot(
  session: AgentSessionEntity,
  agent: AgentEntity,
  uniqueModelId: UniqueModelId,
  materialized?: ConnectionMaterializationFacts
): Promise<ConnectionConfig> {
  const cwd = session.workspace?.path
  if (!cwd) throw new Error(`Agent session ${session.id} has no workspace path`)
  let routeFacts = materialized?.route
  if (!routeFacts) {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
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
  const skills = materialized?.skills ?? (await buildSkillWhitelist(agent.id, cwd))
  const linkedChannelId = materialized
    ? materialized.linkedChannelId
    : (agentChannelService.findBySessionId(session.id)?.id ?? null)
  const rebuildFacts = {
    modelId: uniqueModelId,
    route: routeFacts,
    cwd,
    instructions: agent.instructions ?? null,
    builtinRole: agent.configuration?.builtin_role ?? null,
    bootstrapCompleted: agent.configuration?.bootstrap_completed ?? null,
    skills: [...skills].sort(),
    maxTurns: agent.configuration?.max_turns ?? null,
    envVars: Object.entries(agent.configuration?.env_vars ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    disabledTools: [...(agent.disabledTools ?? [])].sort(),
    mcp: materialized?.mcp ?? deriveMcpDefinitionFacts(agent.mcps),
    linkedChannelId
  }

  return {
    rebuildSignature: createHash('sha256').update(JSON.stringify(rebuildFacts)).digest('hex'),
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
  connectionModelId?: UniqueModelId
): Promise<ClaudeCodeAgentSessionQueryRequest | undefined> {
  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId) return undefined

  const agent = agentService.getAgent(session.agentId)
  if (!agent?.model) return undefined
  const linkedChannelSnapshot = agentChannelService.findBySessionId(session.id)
  const mcpServerSnapshots = captureMcpServerSnapshots(agent.mcps)

  const uniqueModelId = connectionModelId ?? agent.model
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
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
  const route = await resolveClaudeCodeRuntimeRoute(provider, model, modelId, baseUrl, planModel, smallModel)
  const resumeSessionId =
    effectiveResume ?? agentSessionMessageService.getLastRuntimeResumeToken(session.id) ?? undefined
  const settings = mergeRuntimeSettings(
    await buildClaudeCodeSessionSettings(
      session,
      provider,
      {
        lastAgentSessionId: resumeSessionId,
        mcpServerSnapshots,
        linkedChannelSnapshot
      },
      agent
    ),
    route
  )
  // Capture the baseline from the exact route, MCP rows, agent snapshot, and skill list that
  // materialized this request. This runs after route materialization so a first-use gateway key is
  // already persisted and the connect-time fingerprint matches later pure reconciles.
  const connectionConfig = await deriveConnectionConfigFromSnapshot(session, agent, uniqueModelId, {
    route: toConnectionRouteFacts(route),
    mcp: deriveMcpDefinitionFacts(agent.mcps, mcpServerSnapshots),
    skills: settings.skills ?? [],
    linkedChannelId: linkedChannelSnapshot?.id ?? null
  })
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
    credentialsFingerprint: route.credentialsFingerprint,
    settings,
    sdkModelId
  }
}

/**
 * Pure (read-only) half of the route resolution: branch decision, model-id slots, baseUrl and the
 * credentials fingerprint — everything the staleness signature needs. MUST stay side-effect free:
 * no `getRotatedApiKey` (advances rotation), no gateway `ensureValidApiKey` (persists a key on
 * first use) or `start()` (boots the HTTP server). Credential *values* are materialized by
 * {@link resolveClaudeCodeRuntimeRoute} on the connect path only.
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
    provider: primaryProvider
  }
  const opusRef = primaryRef
  // Unset plan/small models fall back to `primaryRef` (the effective connection model). The caller also
  // passes them unset to pin a captured turn's route to its primary (see `pinSubModelsToPrimary`), so a
  // mid-window sub-model edit can't mix into the captured connection — the whole route stays on the pinned
  // model (consistent env values, no spurious gateway switch when the edit points at another provider).
  const sonnetRef = resolveRuntimeModelRef(planModel, primaryRef)
  const haikuRef = resolveRuntimeModelRef(smallModel, primaryRef)
  const modelRefs = [primaryRef, opusRef, sonnetRef, haikuRef]

  // External-cli (e.g. claude-code) authenticates only through the SDK's
  // subscription login, which can serve *only* this provider's own models. A
  // plan/small model pointing at another provider can't run on that login — and
  // must not fall through to the gateway branch below, which would inject an API
  // key (abandoning the login) and ship an unresolvable `claude-code:*` id to
  // the gateway, bricking the agent. Pin every sub-model back onto the primary
  // so the agent still runs on the subscription login.
  if (isExternalCliProvider(primaryProvider)) {
    const pinToPrimary = (ref: RuntimeModelRef) =>
      ref.providerId === primaryProvider.id ? ref.apiModelId : primaryRef.apiModelId
    return {
      branch: 'external-cli',
      credentialsFingerprint: 'external-cli',
      modelIds: {
        primary: primaryRef.apiModelId,
        opus: pinToPrimary(opusRef),
        sonnet: pinToPrimary(sonnetRef),
        haiku: pinToPrimary(haikuRef)
      }
    }
  }

  const shouldUseGateway = modelRefs.some(
    (ref) => ref.providerId !== primaryProvider.id || !ref.provider || !supportsAnthropicMessages(ref.provider)
  )

  if (shouldUseGateway) {
    const config = application.get('ApiGatewayService').getCurrentConfig()
    const host = config.host || '127.0.0.1'
    const port = config.port || 23333
    // Fingerprint the persisted gateway key WITHOUT `ensureValidApiKey` (which would generate and
    // persist one). Before the gateway's first activation the preference is empty — the signature
    // changes once when the key is generated, costing a single extra rebuild. Accepted.
    const gatewayKey = application.get('PreferenceService').get('feature.api_gateway.api_key')
    return {
      branch: 'gateway',
      baseUrl: `http://${host}:${port}`,
      credentialsFingerprint: fingerprintCredentials([typeof gatewayKey === 'string' ? gatewayKey : '']),
      modelIds: {
        primary: toGatewayModelId(primaryRef),
        opus: toGatewayModelId(opusRef),
        sonnet: toGatewayModelId(sonnetRef),
        haiku: toGatewayModelId(haikuRef)
      }
    }
  }

  const anthropicBaseUrl = resolveAnthropicBaseUrl(primaryProvider, primaryBaseUrl)
  // Fingerprint the enabled key SET (read-only), not the rotated pick — so prewarm/consume builds
  // that rotate onto different keys still sign identically, while enabling/disabling/editing a key
  // invalidates warm reuse.
  const enabledKeys = providerService.getApiKeys(primaryProvider.id, { enabled: true }).map((entry) => entry.key)
  return {
    branch: 'direct',
    baseUrl: anthropicBaseUrl,
    credentialsFingerprint: fingerprintCredentials(enabledKeys),
    modelIds: {
      primary: withDeepSeek1mSuffix(primaryRef.apiModelId, anthropicBaseUrl),
      opus: withDeepSeek1mSuffix(opusRef.apiModelId, anthropicBaseUrl),
      sonnet: withDeepSeek1mSuffix(sonnetRef.apiModelId, anthropicBaseUrl),
      haiku: withDeepSeek1mSuffix(haikuRef.apiModelId, anthropicBaseUrl)
    }
  }
}

/** Effectful half: materializes the credentials for the branch {@link deriveRouteFacts} picked. */
async function resolveClaudeCodeRuntimeRoute(
  primaryProvider: Provider,
  primaryModel: Model,
  primaryModelId: string,
  primaryBaseUrl: string,
  planModel: UniqueModelId | null | undefined,
  smallModel: UniqueModelId | null | undefined
): Promise<ClaudeCodeRuntimeRoute> {
  const facts = deriveRouteFacts(primaryProvider, primaryModel, primaryModelId, primaryBaseUrl, planModel, smallModel)

  switch (facts.branch) {
    case 'external-cli':
      return facts
    case 'gateway': {
      const gateway = await resolveApiGatewayRuntime()
      return {
        ...facts,
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
        credentialsFingerprint: fingerprintCredentials([gateway.apiKey])
      }
    }
    case 'direct': {
      const providerApiKey = providerService.getRotatedApiKey(primaryProvider.id)
      const runtimeApiKey = providerApiKey || (isOllamaProvider(primaryProvider) ? OLLAMA_PLACEHOLDER_AUTH_TOKEN : '')
      return {
        ...facts,
        apiKey: runtimeApiKey,
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
    modelIds: route.modelIds
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
      provider
    }
  } catch {
    return { providerId, modelId, apiModelId: modelId }
  }
}

function supportsAnthropicMessages(provider: Provider): boolean {
  return (
    provider.id === 'anthropic' ||
    provider.presetProviderId === 'anthropic' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ||
    Object.prototype.hasOwnProperty.call(provider.endpointConfigs ?? {}, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  )
}

async function resolveApiGatewayRuntime(): Promise<{ baseUrl: string; apiKey: string }> {
  const apiGatewayService = application.get('ApiGatewayService')
  const apiKey = await apiGatewayService.ensureValidApiKey()
  if (!apiGatewayService.isRunning()) {
    await apiGatewayService.start()
  }
  const config = apiGatewayService.getCurrentConfig()
  const host = config.host || '127.0.0.1'
  const port = config.port || 23333
  return { baseUrl: `http://${host}:${port}`, apiKey }
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

function mergeRuntimeSettings(settings: ClaudeCodeSettings, route: ClaudeCodeRuntimeRoute): ClaudeCodeSettings {
  return {
    ...settings,
    env: {
      ...settings.env,
      ANTHROPIC_MODEL: route.modelIds.primary,
      ANTHROPIC_DEFAULT_OPUS_MODEL: route.modelIds.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: route.modelIds.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: route.modelIds.haiku,
      ...(route.apiKey ? { ANTHROPIC_API_KEY: route.apiKey, ANTHROPIC_AUTH_TOKEN: route.apiKey } : {}),
      ...(route.baseUrl ? { ANTHROPIC_BASE_URL: route.baseUrl } : {})
    }
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
    credentialsFingerprint: request.credentialsFingerprint
  }
}
