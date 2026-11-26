import { withStartupSignal } from '@cherrystudio/agent-runtime/stdio'
import { getShellEnv } from '@main/utils/shellEnv'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import type { AgentRuntimeConnectInput } from '../types'

export async function connect(input: AgentRuntimeConnectInput, config: LocalAgentConfiguration, cwd: string) {
  const { CursorConnection } = await import('./CursorConnection')
  const live = new CursorConnection(input.sessionId, input.agentId, config, input.headless)
  return withStartupSignal(
    AbortSignal.timeout(30_000),
    () => live.start(cwd, input.resumeToken),
    () => live.close()
  )
}

export async function listModels(config: LocalAgentConfiguration) {
  const { listCursorModels } = await import('@cherrystudio/agent-runtime-cursor')
  return { models: await listCursorModels(config.env, getShellEnv, AbortSignal.timeout(30_000)) }
}

export async function bindAccount(config: LocalAgentConfiguration) {
  const { bindCursorAccount } = await import('@cherrystudio/agent-runtime-cursor')
  return bindCursorAccount(config.env, getShellEnv)
}

export async function check(config: LocalAgentConfiguration): Promise<void> {
  await listModels(config)
}
