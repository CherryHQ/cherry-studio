import { application } from '@application'
import { t } from '@main/i18n'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { McpResource } from '@shared/types/mcp'

import { listBuiltinToolPolicies, toMcpRuntimeName } from './builtinToolPolicy'
import { toolApprovalRegistry } from './ToolApprovalRegistry'

const loadTool = 'mcp__skills__load_mcp_skill'
const executionTools = new Set([
  'Bash',
  'bash',
  'powershell',
  'PowerShell',
  'codemode',
  'Skill',
  'Agent',
  'Task',
  'subagent',
  'message_subagent',
  ...listBuiltinToolPolicies()
    .filter((tool) => tool.executesCode)
    .map((tool) => toMcpRuntimeName(tool).replaceAll('-', '_'))
])

export function getMcpSkillToolApproval(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  permissionMode?: AgentPermissionMode,
  requestSignal?: AbortSignal
) {
  if (permissionMode === 'bypassPermissions') return undefined
  const skills = application.get('McpSkillService')
  const context = skills.captureContext(sessionId)
  if (!context) return undefined
  const name = toolName.replaceAll('-', '_')
  const isLoad = name === loadTool
  const schedulesExecution = name === 'mcp__cherry_tools__cron' && (input.action === 'add' || input.action === 'update')
  if (!isLoad && (!context.origins.length || (!executionTools.has(name) && !schedulesExecution))) return undefined
  const target =
    isLoad && typeof input.server_id === 'string' ? skills.captureOrigin(sessionId, input.server_id) : undefined
  const signal = AbortSignal.any([
    context.signal,
    ...(target ? [target.signal] : []),
    ...(requestSignal ? [requestSignal] : [])
  ])
  const validate = () => {
    signal.throwIfAborted()
    context.validate()
    target?.validate()
  }
  validate()
  return {
    signal,
    approve: () => {
      validate()
      return isLoad
        ? toolApprovalRegistry.bindInvocation({ sessionId, toolName: loadTool, input, signal, validate })
        : { ...input }
    }
  }
}

export async function guardMcpSkillResourceRead<T extends { contents: McpResource[] }>(
  sessionId: string,
  serverId: string,
  uri: string,
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const context = application.get('McpSkillService').captureResourceRead(sessionId, serverId, uri)
  if (!context) return run(signal)
  signal = AbortSignal.any([signal, context.signal])
  const foreign = context.origins.filter((origin) => origin.serverId !== serverId)
  if (foreign.length) {
    const decision = await application.get('AgentSessionRuntimeService').requestToolApproval(sessionId, {
      toolName: 'mcp__skills__read_mcp_skill_file',
      input: {
        source_servers: foreign.map((origin) => ({
          id: origin.serverId,
          name: origin.serverName,
          skill_uri: origin.uri
        })),
        server_id: serverId,
        server_name: context.target.name,
        resource_uri: uri
      },
      signal
    })
    if (!decision.approved) throw new Error(decision.reason ?? t('mcp.skills.denied'))
  }
  signal.throwIfAborted()
  const result = await run(signal)
  signal.throwIfAborted()
  return { ...result, contents: context.verify(result.contents) }
}
