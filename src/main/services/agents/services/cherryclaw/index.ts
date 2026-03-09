import { loggerService } from '@logger'
import type { CherryClawConfiguration, GetAgentSessionResponse } from '@types'

import type { AgentServiceInterface, AgentStream, AgentThinkingOptions } from '../../interfaces/AgentStreamInterface'
import { agentServiceRegistry } from '../AgentServiceRegistry'
import { HeartbeatReader } from './heartbeat'
import { SoulReader } from './soul'

const logger = loggerService.withContext('CherryClawService')

/**
 * CherryClawService — a Claude Code variant with soul-driven personality
 * and scheduler-based autonomous operation.
 *
 * Delegates to ClaudeCodeService (via registry) with a soul-enhanced system prompt.
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

    // Build soul-enhanced session
    let enhancedSession = session

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

    // Delegate to claude-code service (CherryClaw is a Claude Code variant)
    const claudeCodeService = agentServiceRegistry.getService('claude-code')
    return claudeCodeService.invoke(prompt, enhancedSession, abortController, lastAgentSessionId, thinkingOptions)
  }
}

export default CherryClawService
