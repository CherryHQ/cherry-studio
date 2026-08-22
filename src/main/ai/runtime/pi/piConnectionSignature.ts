import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import {
  type McpServerSnapshotMap,
  type NotifyChannel,
  resolveAgentNotificationContext,
  resolveLinkedNotifyChannel
} from '@main/ai/runtime/agentMcpServers'
import { skillService } from '@main/ai/skills/SkillService'
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

function resolveEffectiveAgentLanguage(agent: AgentEntity): string | null {
  const perAgent = agent.configuration?.language as string | undefined
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
  return null
}

export interface PiConnectionSnapshot {
  agent: AgentEntity
  session: AgentSessionEntity
  provider: Provider
  model: Model
  enabledApiKeys: readonly ApiKeyEntry[]
  additionalSkillPaths: readonly string[]
  mcpServerSnapshots: McpServerSnapshotMap
  linkedChannel: NotifyChannel | null
  signature: string
}

export class PiInvalidConnectionSnapshotError extends Error {}

/**
 * Capture every reconcilable fact consumed while constructing a Pi connection.
 * Prompt files intentionally remain connection-lifetime snapshots: changing them
 * does not invalidate a warm connection or its provider prompt cache.
 * The effective agent language (per-agent `configuration.language` or global
 * `agent.language` preference) is a rebuild fact: changing it invalidates the
 * warm connection so the new language instruction is baked into the next
 * connection's system prompt and prompt cache.
 */
export async function capturePiConnectionSnapshot(
  sessionId: string,
  agentId: string,
  requestedModelId?: UniqueModelId,
  selectedKnowledgeBaseIds?: readonly string[]
): Promise<PiConnectionSnapshot> {
  const session = agentSessionService.getById(sessionId)
  const agent = agentService.getAgent(agentId)
  if (!session?.agentId || session.agentId !== agentId || !agent?.model) {
    throw new PiInvalidConnectionSnapshotError(`Invalid Pi session snapshot: ${sessionId}`)
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
          effectiveLanguage: resolveEffectiveAgentLanguage(agent)
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
