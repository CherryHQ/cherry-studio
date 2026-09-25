import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { resolveLinkedNotifyChannel } from '@main/ai/runtime/agentMcpServers'
import { findBuiltinToolPolicy } from '@main/ai/toolApproval/builtinToolPolicy'

import type { UarHostToolDisposition } from './UarHostToolAdmission'
import { toUarToolName } from './uarToolNames'

export function resolveUarHostToolDisposition(
  sessionId: string,
  agentId: string,
  toolName: string
): UarHostToolDisposition {
  const agent = agentService.getAgent(agentId)
  if (!agent) return 'deny'
  if ((agent.disabledTools ?? []).map(toUarToolName).includes(toolName)) return 'deny'
  const mode = agent.configuration?.permission_mode ?? 'default'
  if (mode === 'plan') return 'deny'

  const linkedChannel = resolveLinkedNotifyChannel(sessionId, agent.id)
  const mountedServers = resolveMountedMcpServers(agent, {
    browserEnabled: application.get('PreferenceService').get('app.browser.agent_control.enabled'),
    channelLinked: linkedChannel !== null
  })
  const builtin = findBuiltinToolPolicy(`mcp__${toolName}`, mountedServers)
  if (builtin?.approval === 'auto') return 'auto'
  if (builtin?.approval === 'required') {
    return mode === 'bypassPermissions' && builtin.bypassApproval === 'lift' ? 'auto' : 'ask'
  }
  if (mode === 'bypassPermissions' || mode === 'auto') return 'auto'
  if (mode === 'acceptEdits' && isManagedFilesystemTool(toolName)) return 'auto'
  return 'ask'
}

function isManagedFilesystemTool(toolName: string): boolean {
  return mcpServerService
    .list({})
    .items.some(
      (server) => server.reference?.startsWith('filesystem:') && toolName.startsWith(toUarToolName(`${server.id}__`))
    )
}
