import { AgentConfigurationSchema, type AgentType, type GetAgentSessionResponse } from '@types'

import type { AgentServiceInterface } from '../../interfaces/AgentStreamInterface'
import ClaudeCodeService from '../claudecode'
import { CommandWorkerService } from './CommandWorkerService'

const claudeCodeService = new ClaudeCodeService()
const commandWorkerService = new CommandWorkerService()

const runnerRegistry: Record<AgentType, AgentServiceInterface> = {
  'claude-code': claudeCodeService,
  codex: commandWorkerService,
  opencode: commandWorkerService,
  'gemini-cli': commandWorkerService,
  hermes: commandWorkerService,
  aider: commandWorkerService,
  'shell-script': commandWorkerService,
  'openclaw-bot': commandWorkerService
}

export function getAgentRunner(
  agentType: AgentType,
  session?: Pick<GetAgentSessionResponse, 'configuration'>
): AgentServiceInterface {
  const configuration = AgentConfigurationSchema.parse(session?.configuration ?? {})
  if (agentType === 'claude-code' && configuration.worker_family === 'claude-code' && configuration.worker_command) {
    return commandWorkerService
  }

  return runnerRegistry[agentType] ?? claudeCodeService
}
