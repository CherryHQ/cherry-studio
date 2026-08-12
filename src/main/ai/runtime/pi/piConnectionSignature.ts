import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { skillService } from '@main/ai/skills/SkillService'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

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

/** Hash every spawn-frozen fact consumed while constructing a Pi connection. */
export async function buildPiConnectionSignature(
  sessionId: string,
  agent: AgentEntity,
  modelId: UniqueModelId,
  selectedKnowledgeBaseIds?: readonly string[]
): Promise<string> {
  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId || session.agentId !== agent.id) throw new Error(`Invalid Pi session snapshot: ${sessionId}`)

  const parsed = parseUniqueModelId(modelId)
  const [provider, model, skills] = await Promise.all([
    providerService.getByProviderId(parsed.providerId),
    modelService.getByKey(parsed.providerId, parsed.modelId),
    skillService.list({ agentId: agent.id })
  ])
  const enabledSkills = skills.filter((skill) => skill.isEnabled)
  const mcpServers = (agent.mcps ?? []).map((idOrName) => mcpServerService.findByIdOrName(idOrName) ?? { idOrName })
  const catalog = application.get('McpCatalogService')
  const mcpTools = mcpServers.flatMap((server) =>
    'id' in server ? [{ serverId: server.id, tools: catalog.listTools(server.id, { includeDisabled: false }) }] : []
  )
  const linkedChannel = agentChannelService
    .listChannels({ agentId: agent.id })
    .find((channel) => channel.sessionId === sessionId)
  const apiKeys = providerService.getApiKeys(parsed.providerId, { enabled: true })
  const configuration = { ...agent.configuration, permission_mode: undefined }

  const snapshot = stableValue({
    agent: { ...agent, updatedAt: undefined, configuration },
    session: { workspaceId: session.workspaceId, workspace: session.workspace },
    modelId,
    provider,
    model,
    apiKeys,
    enabledSkills,
    mcpServers,
    mcpTools,
    linkedChannelId: linkedChannel?.id ?? null,
    knowledgeBaseIds: resolveKnowledgeBaseScope(agent.knowledgeBaseIds, selectedKnowledgeBaseIds)
  })
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}
