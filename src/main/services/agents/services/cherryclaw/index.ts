import { loggerService } from '@logger'
import ClawServer from '@main/mcpServers/claw'
import type { CherryClawConfiguration, GetAgentSessionResponse } from '@types'

import { SOUL_MODE_DISALLOWED_TOOLS } from '@shared/agents/claudecode/constants'

import type { EnhancedSessionFields } from '../claudecode/enhanced-session'
import { HeartbeatReader } from './heartbeat'
import { PromptBuilder } from './prompt'

const logger = loggerService.withContext('CherryClawEnhancer')

type EnhancedSession = GetAgentSessionResponse & EnhancedSessionFields

const promptBuilder = new PromptBuilder()
export const heartbeatReader = new HeartbeatReader()

/**
 * Apply CherryClaw enhancements to a session based on its configuration.
 *
 * When `soul_enabled` is set, builds a custom system prompt from workspace
 * soul files, injects the claw MCP server, and disables tools not suited
 * for autonomous operation. Returns the original session unchanged when
 * no CherryClaw features are configured.
 */
export async function applyCherryClawEnhancements(session: GetAgentSessionResponse): Promise<EnhancedSession> {
  const config = session.configuration as CherryClawConfiguration | undefined
  if (!config?.soul_enabled) {
    return session
  }

  const workspacePath = session.accessible_paths[0]
  let enhancedSession: EnhancedSession = session

  // Build full custom system prompt from workspace files (soul.md, user.md, memory/FACT.md, system.md)
  if (workspacePath) {
    const systemPrompt = await promptBuilder.buildSystemPrompt(workspacePath)
    logger.info('Built custom system prompt for CherryClaw', {
      workspacePath,
      promptLength: systemPrompt.length
    })
    enhancedSession = {
      ...session,
      _systemPrompt: systemPrompt
    }
  }

  // Inject the claw MCP server as an in-memory instance for autonomous task management
  // and disable the SDK's builtin cron tools so the agent uses our MCP cron tool instead
  const clawServer = new ClawServer(session.agent_id)
  enhancedSession = {
    ...enhancedSession,
    _internalMcpServers: {
      claw: {
        type: 'inmem',
        instance: clawServer.mcpServer
      }
    },
    _disallowedTools: [...SOUL_MODE_DISALLOWED_TOOLS]
  }

  // If the agent has an explicit allowed_tools whitelist, append the claw MCP
  // tool names so the SDK doesn't hide them.
  const clawMcpTools = ['mcp__claw__*']
  const currentAllowed = enhancedSession.allowed_tools
  if (Array.isArray(currentAllowed) && currentAllowed.length > 0) {
    const missing = clawMcpTools.filter((t) => !currentAllowed.includes(t))
    if (missing.length > 0) {
      enhancedSession = { ...enhancedSession, allowed_tools: [...currentAllowed, ...missing] }
    }
  }

  logger.debug('CherryClaw enhancements applied', {
    agentId: session.agent_id,
    mcpServers: Object.keys(enhancedSession._internalMcpServers ?? {}),
    allowedTools: enhancedSession.allowed_tools
  })

  return enhancedSession
}
