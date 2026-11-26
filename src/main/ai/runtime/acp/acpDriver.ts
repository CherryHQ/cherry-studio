import { application } from '@application'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { withConnectionTimeout } from '../connectionTimeout'
import type { AgentRuntimeConnectInput } from '../types'
import { withAcpLoginFallback } from './acpLaunch'
import { AcpManagement } from './AcpManagement'

export async function connect(input: AgentRuntimeConnectInput, config: LocalAgentConfiguration, cwd: string) {
  const { AcpConnection } = await import('./AcpConnection')
  return withAcpLoginFallback(config, async (selected) => {
    const live = new AcpConnection(input.sessionId, input.agentId, selected, input.headless)
    try {
      return await withConnectionTimeout(live.start(cwd, input.resumeToken))
    } catch (error) {
      await live.close()
      throw error
    }
  })
}

export function listModels(config: LocalAgentConfiguration) {
  const cwd = application.getPath('cherry.bin')
  return withAcpLoginFallback({ ...config, nativeModel: undefined }, (selected) =>
    withManagement(selected, (access) => access.listModels(cwd))
  )
}

export function check(config: LocalAgentConfiguration) {
  const cwd = application.getPath('cherry.bin')
  return withManagement(config, (access) => access.check(cwd))
}

async function withManagement<T>(config: LocalAgentConfiguration, operation: (access: AcpManagement) => Promise<T>) {
  const access = new AcpManagement(config)
  try {
    return await withConnectionTimeout(operation(access))
  } finally {
    await access.close()
  }
}
