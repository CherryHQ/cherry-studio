import { application } from '@application'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { withConnectionTimeout } from '../connectionTimeout'
import type { AgentRuntimeConnectInput } from '../types'
import { loadLocalClaudeRuntime } from './loaders'

export async function connect(input: AgentRuntimeConnectInput, config: LocalAgentConfiguration, cwd: string) {
  const { LocalClaudeConnection } = await loadLocalClaudeRuntime()
  const live = new LocalClaudeConnection(input, config)
  const startup = live.start(cwd)
  try {
    return await withConnectionTimeout(startup, () => live.cancelStartup())
  } catch (error) {
    await startup.catch(() => {})
    await live.close()
    throw error
  }
}

export async function listModels(config: LocalAgentConfiguration) {
  const cwd = application.getPath('cherry.bin')
  const { probeLocalClaude } = await loadLocalClaudeRuntime()
  const abort = new AbortController()
  const probe = probeLocalClaude(config, cwd, abort)
  try {
    return await withConnectionTimeout(probe, () => abort.abort())
  } finally {
    await probe.catch(() => {})
  }
}

export async function check(config: LocalAgentConfiguration): Promise<void> {
  await listModels(config)
}
