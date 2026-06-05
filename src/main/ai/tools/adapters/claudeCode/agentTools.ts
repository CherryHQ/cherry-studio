import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { claudeCodeBuiltinToolDescriptors } from '@shared/ai/claudecode/builtinTools'
import {
  buildClaudeMcpToolName,
  type ClaudeToolDecision,
  type ClaudeToolDescriptor,
  type ClaudeToolPolicy,
  normalizeClaudeBuiltinName,
  resolveClaudeToolAccess,
  resolveClaudeToolInvocationAccess
} from '@shared/ai/claudecode/toolRules'
import type { Tool } from '@shared/ai/tool'
import { resolveMcpSourceToolAccess } from '@shared/ai/tools/mcpSourcePolicy'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('ClaudeCodeAgentTools')

export function descriptorToTool(descriptor: ClaudeToolDescriptor, policy: ClaudeToolPolicy): Tool {
  const access = resolveClaudeToolAccess(descriptor, policy)
  return descriptorToToolWithAccess(descriptor, access)
}

function descriptorToToolWithAccess(descriptor: ClaudeToolDescriptor, access: ClaudeToolDecision): Tool {
  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    origin: descriptor.origin,
    approval: access.approval,
    sourceId: descriptor.sourceId,
    sourceName: descriptor.sourceName
  }
}

export function buildClaudeToolPolicy(
  agent: Partial<Pick<AgentEntity, 'configuration' | 'allowedTools'>>
): ClaudeToolPolicy {
  return {
    permissionMode: agent.configuration?.permission_mode,
    allowedTools: agent.allowedTools ?? []
  }
}

async function listMcpDescriptors(mcpIds: readonly string[]): Promise<{
  descriptors: ClaudeToolDescriptor[]
}> {
  if (mcpIds.length === 0) return { descriptors: [] }

  const descriptors: ClaudeToolDescriptor[] = []

  for (const id of mcpIds) {
    try {
      const server = await mcpServerService.getById(id)
      const tools = await application.get('McpCatalogService').listTools(server.id)

      for (const tool of tools) {
        const sourceAccess = resolveMcpSourceToolAccess(server, tool)
        if (!sourceAccess.enabled) continue
        descriptors.push({
          id: buildClaudeMcpToolName(server.name, tool.name),
          name: tool.name,
          description: tool.description || '',
          origin: 'mcp',
          sourceId: server.id,
          sourceName: server.name,
          sourceToolName: tool.name,
          sourceApproval: sourceAccess.approval
        })
      }
    } catch (error) {
      logger.warn('Failed to list MCP tools for agent catalog', { id, error })
    }
  }

  return { descriptors }
}

export async function listClaudeAgentToolDescriptors(agent: Pick<AgentEntity, 'mcps'>): Promise<{
  descriptors: ClaudeToolDescriptor[]
}> {
  const mcpCatalog = await listMcpDescriptors(agent.mcps ?? [])
  return {
    descriptors: [...claudeCodeBuiltinToolDescriptors(), ...mcpCatalog.descriptors]
  }
}

export async function listClaudeAgentTools(agent: AgentEntity): Promise<Tool[]> {
  const { descriptors } = await listClaudeAgentToolDescriptors(agent)
  const policy = buildClaudeToolPolicy(agent)
  return descriptors.map((descriptor) => descriptorToTool(descriptor, policy))
}

function findRuntimeDescriptor(
  descriptors: readonly ClaudeToolDescriptor[],
  runtimeName: string
): ClaudeToolDescriptor | undefined {
  const normalizedRuntimeName = normalizeClaudeBuiltinName(runtimeName)
  return descriptors.find(
    (item) =>
      item.id === runtimeName ||
      normalizeClaudeBuiltinName(item.id) === normalizedRuntimeName ||
      item.name === normalizedRuntimeName
  )
}

function injectedRuntimeTool(runtimeName: string): Tool {
  return {
    id: runtimeName,
    name: runtimeName,
    origin: 'internal',
    approval: 'auto'
  }
}

export interface ClaudeAgentToolPolicySnapshot {
  resolve(runtimeName: string, input?: unknown): Tool | undefined
  setPermissionMode(permissionMode: AgentPermissionMode | undefined): void
  update(agent: AgentEntity): Promise<void>
}

export async function createClaudeAgentToolPolicySnapshot(
  agent: AgentEntity,
  options: { autoAllowRuntimeNamePrefixes?: readonly string[] } = {}
): Promise<ClaudeAgentToolPolicySnapshot> {
  let descriptors: ClaudeToolDescriptor[] = []
  let policy: ClaudeToolPolicy = {}

  const rebuild = async (nextAgent: AgentEntity) => {
    const catalog = await listClaudeAgentToolDescriptors(nextAgent)
    descriptors = catalog.descriptors
    policy = buildClaudeToolPolicy(nextAgent)
  }

  await rebuild(agent)

  return {
    resolve(runtimeName, input) {
      if (options.autoAllowRuntimeNamePrefixes?.some((prefix) => runtimeName.startsWith(prefix))) {
        return injectedRuntimeTool(runtimeName)
      }
      const descriptor = findRuntimeDescriptor(descriptors, runtimeName)
      if (!descriptor) return undefined
      const access = resolveClaudeToolInvocationAccess(descriptor, policy, { toolName: runtimeName, input })
      return descriptorToToolWithAccess(descriptor, access)
    },

    setPermissionMode(permissionMode) {
      policy = { ...policy, permissionMode }
    },

    update(agent) {
      return rebuild(agent)
    }
  }
}
