import { application } from '@application'
import type { RuntimeAccountAccess } from '@cherrystudio/agent-runtime'
import { withStartupSignal } from '@cherrystudio/agent-runtime/stdio'
import type { LocalAgentConfiguration, LocalAgentRuntime } from '@shared/ai/localAgent'

import type { LocalRuntimeConnectInput } from '../types'
import { loadLocalClaudeRuntime } from './loaders'

export async function connect(input: LocalRuntimeConnectInput, config: LocalAgentRuntime, cwd: string) {
  const { LocalClaudeConnection } = await loadLocalClaudeRuntime()
  const live = new LocalClaudeConnection(input, config)
  return withStartupSignal(
    AbortSignal.timeout(30_000),
    () => live.start(cwd),
    async () => {
      live.cancelStartup()
      await live.close()
    }
  )
}

export async function listModels(config: LocalAgentConfiguration) {
  const cwd = application.getPath('cherry.bin')
  const { probeLocalClaude } = await loadLocalClaudeRuntime()
  return probeLocalClaude(config, cwd, AbortSignal.timeout(30_000))
}

export async function check(config: LocalAgentConfiguration): Promise<void> {
  await listModels(config)
}

export function bindAccount(config: LocalAgentConfiguration): RuntimeAccountAccess {
  return {
    async readSubscriptionUsage(signal) {
      if (config.sourceModelViaGateway) return { status: 'unsupported' }
      const { probeLocalClaudeSubscription } = await loadLocalClaudeRuntime()
      return probeLocalClaudeSubscription(config, application.getPath('cherry.bin'), signal)
    }
  }
}
