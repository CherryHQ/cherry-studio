import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { claudeCodeBuiltinToolDescriptors } from '@shared/ai/claudecode/builtinTools'
import {
  buildClaudeMcpToolName,
  type ClaudeToolDecision,
  type ClaudeToolDescriptor,
  type ClaudeToolPolicy,
  isClaudeToolDisabled,
  normalizeClaudeBuiltinName,
  resolveClaudeToolAccess,
  resolveClaudeToolInvocationAccess
} from '@shared/ai/claudecode/toolRules'
import type { Tool } from '@shared/ai/tool'
import { resolveMcpSourceToolAccess } from '@shared/ai/tools/mcpSourcePolicy'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('ClaudeCodeAgentTools')

type ClaudeToolPolicyAgent = Pick<AgentEntity, 'mcps' | 'disabledTools' | 'configuration'>

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
  agent: Partial<Pick<AgentEntity, 'configuration' | 'disabledTools'>>
): ClaudeToolPolicy {
  return {
    permissionMode: agent.configuration?.permission_mode,
    disabledTools: agent.disabledTools
  }
}

async function listMcpDescriptors(mcpIds: readonly string[]): Promise<{
  descriptors: ClaudeToolDescriptor[]
  failedMcpIds: Set<string>
}> {
  if (mcpIds.length === 0) return { descriptors: [], failedMcpIds: new Set() }

  const descriptors: ClaudeToolDescriptor[] = []
  const failedMcpIds = new Set<string>()

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
      failedMcpIds.add(id)
      logger.warn('Failed to list MCP tools for agent catalog', { id, error })
    }
  }

  return { descriptors, failedMcpIds }
}

export async function listClaudeAgentToolDescriptors(agent: Pick<AgentEntity, 'mcps'>): Promise<{
  descriptors: ClaudeToolDescriptor[]
  failedMcpIds: Set<string>
}> {
  const mcpCatalog = await listMcpDescriptors(agent.mcps ?? [])
  return {
    descriptors: [...claudeCodeBuiltinToolDescriptors(), ...mcpCatalog.descriptors],
    failedMcpIds: mcpCatalog.failedMcpIds
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

function fallbackRuntimeDescriptor(runtimeName: string): ClaudeToolDescriptor {
  const mcpMatch = /^mcp__(.+)__(.+)$/.exec(runtimeName)
  if (mcpMatch) {
    return {
      id: runtimeName,
      name: mcpMatch[2],
      origin: 'mcp',
      sourceName: mcpMatch[1],
      sourceToolName: mcpMatch[2]
    }
  }
  const normalizedName = normalizeClaudeBuiltinName(runtimeName)
  return {
    id: runtimeName,
    name: normalizedName,
    origin: 'builtin'
  }
}

export interface ClaudeAgentToolPolicySnapshot {
  resolve(runtimeName: string, input?: unknown): Tool | undefined
  isDisabled(runtimeName: string): boolean
  getPermissionMode(): AgentPermissionMode | undefined
  setPermissionMode(permissionMode: AgentPermissionMode | undefined): void
  update(agent: ClaudeToolPolicyAgent): Promise<void>
}

export async function createClaudeAgentToolPolicySnapshot(
  agent: ClaudeToolPolicyAgent,
  options: { autoAllowRuntimeNamePrefixes?: readonly string[] } = {}
): Promise<ClaudeAgentToolPolicySnapshot> {
  let descriptors: ClaudeToolDescriptor[] = []
  let policy: ClaudeToolPolicy = {}
  let rebuildSequence = 0

  const rebuild = async (nextAgent: ClaudeToolPolicyAgent) => {
    const sequence = ++rebuildSequence
    const catalog = await listClaudeAgentToolDescriptors(nextAgent)
    if (sequence !== rebuildSequence) return
    const nextDescriptors = [...catalog.descriptors]
    if (catalog.failedMcpIds.size > 0) {
      const existingIds = new Set(nextDescriptors.map((descriptor) => descriptor.id))
      for (const descriptor of descriptors) {
        if (descriptor.origin !== 'mcp' || !descriptor.sourceId) continue
        if (!catalog.failedMcpIds.has(descriptor.sourceId) || existingIds.has(descriptor.id)) continue
        nextDescriptors.push(descriptor)
        existingIds.add(descriptor.id)
      }
    }
    descriptors = nextDescriptors
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

    isDisabled(runtimeName) {
      const descriptor = findRuntimeDescriptor(descriptors, runtimeName) ?? fallbackRuntimeDescriptor(runtimeName)
      return isClaudeToolDisabled(descriptor, policy)
    },

    getPermissionMode() {
      return policy.permissionMode
    },

    setPermissionMode(permissionMode) {
      policy = { ...policy, permissionMode }
    },

    update(agent) {
      return rebuild(agent)
    }
  }
}
