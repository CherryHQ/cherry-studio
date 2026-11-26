import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { withConnectionTimeout } from '../connectionTimeout'
import type { AgentRuntimeConnectInput } from '../types'
import { getCursorApiKey } from './cursorAccount'

export async function connect(input: AgentRuntimeConnectInput, config: LocalAgentConfiguration, cwd: string) {
  const { CursorConnection } = await import('./CursorConnection')
  const live = new CursorConnection(input.sessionId, input.agentId, config, input.headless)
  try {
    return await withConnectionTimeout(live.start(cwd, input.resumeToken))
  } catch (error) {
    await live.close()
    throw error
  }
}

export function listModels(config: LocalAgentConfiguration) {
  return withConnectionTimeout(
    import('@cherrystudio/agent-runtime-cursor').then(async ({ listCursorModels }) => ({
      models: await listCursorModels(await getCursorApiKey(config))
    }))
  )
}

export async function check(config: LocalAgentConfiguration): Promise<void> {
  await listModels(config)
}
