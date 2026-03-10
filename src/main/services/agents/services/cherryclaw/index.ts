import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import type { CherryClawConfiguration, GetAgentSessionResponse } from '@types'

import type { AgentServiceInterface, AgentStream, AgentThinkingOptions } from '../../interfaces/AgentStreamInterface'
import { agentServiceRegistry } from '../AgentServiceRegistry'
import type { InternalMcpServerConfig } from '../claudecode/internal-mcp'
import { HeartbeatReader } from './heartbeat'
import { SoulReader } from './soul'

const logger = loggerService.withContext('CherryClawService')

/**
 * CherryClawService — a Claude Code variant with soul-driven personality
 * and scheduler-based autonomous operation.
 *
 * Delegates to ClaudeCodeService (via registry) with a soul-enhanced system prompt
 * and an injected claw MCP server for autonomous task management.
 */
export class CherryClawService implements AgentServiceInterface {
  private soulReader = new SoulReader()
  readonly heartbeatReader = new HeartbeatReader()

  async invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions
  ): Promise<AgentStream> {
    const config = (session.configuration ?? {}) as CherryClawConfiguration
    const workspacePath = session.accessible_paths[0]

    type EnhancedSession = GetAgentSessionResponse & {
      _internalMcpServers?: Record<string, InternalMcpServerConfig>
      _disallowedTools?: string[]
    }

    // Build soul-enhanced session
    let enhancedSession: EnhancedSession = session

    if (config.soul_enabled !== false && workspacePath) {
      const soulContent = await this.soulReader.readSoul(workspacePath)
      if (soulContent) {
        logger.info('Prepending soul.md to instructions', {
          workspacePath,
          soulLength: soulContent.length
        })
        const originalInstructions = session.instructions ?? ''
        enhancedSession = {
          ...session,
          instructions: soulContent + '\n\n' + originalInstructions
        }
      }
    }

    // Inject the claw MCP server for autonomous task management
    // and disable the SDK's builtin cron tools so the agent uses our MCP cron tool instead
    const apiConfig = await apiConfigService.get()
    enhancedSession = {
      ...enhancedSession,
      _internalMcpServers: {
        'cherry-claw': {
          type: 'http',
          url: `http://${apiConfig.host}:${apiConfig.port}/v1/claw/${session.agent_id}/claw-mcp`,
          headers: {
            Authorization: `Bearer ${apiConfig.apiKey}`
          }
        }
      },
      _disallowedTools: ['CronCreate', 'CronDelete', 'CronList']
    }

    // Delegate to claude-code service (CherryClaw is a Claude Code variant)
    const claudeCodeService = agentServiceRegistry.getService('claude-code')
    return claudeCodeService.invoke(prompt, enhancedSession, abortController, lastAgentSessionId, thinkingOptions)
  }
}

export default CherryClawService
