import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { gatewayCredentialsFingerprint } from '@main/ai/runtime/agentApiGateway'
import {
  type McpServerSnapshotMap,
  type NotifyChannel,
  resolveAgentNotificationContext,
  resolveLinkedNotifyChannel
} from '@main/ai/runtime/agentMcpServers'
import { resolveDshInjectionApi } from '@main/ai/runtime/dsh/modelInjection'
import { skillService } from '@main/ai/skills/SkillService'
import { getEffectiveAgentLanguage } from '@main/ai/utils/agentLanguage'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  )
}

export interface DshConnectionSnapshot {
  agent: AgentEntity
  session: AgentSessionEntity
  provider: Provider
  model: Model
  enabledApiKeys: readonly ApiKeyEntry[]
  /** Canonical dirs of the agent's ENABLED Cherry-managed skills — the composition's customSkillDirs. */
  additionalSkillPaths: readonly string[]
  /** Entity snapshot per agent MCP id used to construct the host-side in-memory bridge. */
  mcpServerSnapshots: McpServerSnapshotMap
  linkedChannel: NotifyChannel | null
  signature: string
}

export class DshInvalidConnectionSnapshotError extends Error {}

/**
 * Capture every reconcilable fact consumed while constructing a dsh connection.
 * The live permission gate (permission_mode, disabledTools) is excluded — it is
 * hot-patched over the bridge, never spawn-frozen.
 * The effective agent language is a rebuild fact: changing it rebuilds the
 * connection so the new language instruction is baked into the next prompt.
 * This trades cache preservation for prompt correctness — the first turn after
 * a language change pays full input-token cost until the new prefix is cached,
 * but the user sees the new language on the next reconcile rather than only on
 * the next natural connection.
 */
export async function captureDshConnectionSnapshot(
  sessionId: string,
  agentId: string,
  requestedModelId?: UniqueModelId,
  selectedKnowledgeBaseIds?: readonly string[]
): Promise<DshConnectionSnapshot> {
  const session = agentSessionService.getById(sessionId)
  const agent = agentService.getAgent(agentId)
  if (!session?.agentId || session.agentId !== agentId || !agent?.model) {
    throw new DshInvalidConnectionSnapshotError(`Invalid dsh session snapshot: ${sessionId}`)
  }

  const modelId = requestedModelId ?? agent.model
  const parsed = parseUniqueModelId(modelId)
  const [provider, model, skills, workspaceSkillPaths] = await Promise.all([
    providerService.getByProviderId(parsed.providerId),
    modelService.getByKey(parsed.providerId, parsed.modelId),
    skillService.list({ agentId: agent.id }),
    skillService.listLocalSkillPaths(session.workspace.path)
  ])
  const enabledSkills = skills.filter((skill) => skill.isEnabled)
  const mcpServerSnapshots = new Map<string, ReturnType<typeof mcpServerService.findByIdOrName>>()
  const mcpServers = (agent.mcps ?? []).map((idOrName) => {
    const server = mcpServerService.findByIdOrName(idOrName)
    mcpServerSnapshots.set(idOrName, server)
    return server ?? { idOrName }
  })
  const catalog = application.get('McpCatalogService')
  const mcpTools = mcpServers.flatMap((server) =>
    'id' in server ? [{ serverId: server.id, tools: catalog.listTools(server.id, { includeDisabled: false }) }] : []
  )
  const linkedChannel = resolveLinkedNotifyChannel(sessionId, agent.id)
  const notificationContext = resolveAgentNotificationContext(sessionId, agent.id, linkedChannel)
  const apiKeys = providerService.getApiKeys(parsed.providerId, { enabled: true })
  const configuration = { ...agent.configuration, permission_mode: undefined }

  const signature = createHash('sha256')
    .update(
      JSON.stringify(
        stableValue({
          agent: { ...agent, updatedAt: undefined, configuration },
          session: { workspaceId: session.workspaceId, workspace: session.workspace },
          modelId,
          provider,
          model,
          apiKeys,
          enabledSkills,
          workspaceSkillPaths,
          mcpServers,
          mcpTools,
          linkedChannel,
          notificationContext,
          knowledgeBaseIds: resolveKnowledgeBaseScope(agent.knowledgeBaseIds, selectedKnowledgeBaseIds),
          effectiveLanguage: getEffectiveAgentLanguage(agent),
          // Gateway routes pin their auth identity so a key edit or enable/running flip rebuilds
          // the warm connection (claude's credentialsFingerprint parity); null on native routes.
          gatewayCredentials:
            resolveDshInjectionApi(provider, model) === undefined ? gatewayCredentialsFingerprint() : null
        })
      )
    )
    .digest('hex')

  return {
    agent,
    session,
    provider,
    model,
    enabledApiKeys: apiKeys,
    additionalSkillPaths: [
      ...enabledSkills.map((skill) => skillService.getSkillDirectory(skill.folderName)),
      ...workspaceSkillPaths
    ],
    mcpServerSnapshots,
    linkedChannel,
    signature
  }
}
