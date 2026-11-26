import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { withConnectionTimeout } from '../connectionTimeout'
import type { AgentRuntimeConnectInput } from '../types'
import { checkCodex, listCodexModels } from './codexManagement'

export async function connect(input: AgentRuntimeConnectInput, config: LocalAgentConfiguration, cwd: string) {
  const { CodexSessionHost } = await import('./CodexSessionHost')
  const host = new CodexSessionHost(input.sessionId, input.agentId, config, input.headless)
  const restore = input.resumeToken
    ? {
        threadId: input.resumeToken,
        kind:
          !input.nativeSessionId && !agentSessionMessageService.hasSessionMessages(input.sessionId)
            ? ('empty-prewarm' as const)
            : ('required' as const)
      }
    : undefined
  const startup = host.start(cwd, restore, input.branchHead)
  try {
    return await withConnectionTimeout(startup)
  } catch (error) {
    await host.close()
    await startup.catch(() => {})
    throw error
  }
}

export function listModels(config: LocalAgentConfiguration) {
  return listCodexModels({ ...config, nativeModel: undefined }, application.getPath('cherry.bin'))
}

export function check(config: LocalAgentConfiguration) {
  return checkCodex(config, application.getPath('cherry.bin'))
}
