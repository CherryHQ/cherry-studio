import { application } from '@application'
import type { RuntimeAccountAccess } from '@cherrystudio/agent-runtime'
import { readCodexAccount, readCodexSubscriptionUsage } from '@cherrystudio/agent-runtime-codex/launcher'
import { withStartupSignal } from '@cherrystudio/agent-runtime/stdio'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { LocalAgentConfiguration, LocalAgentRuntime } from '@shared/ai/localAgent'

import type { LocalRuntimeConnectInput } from '../types'
import { resolveCodexLaunch } from './codexLaunch'
import { checkCodex, listCodexModels } from './codexManagement'
import { codexProcessHost } from './processHost'

export async function connect(input: LocalRuntimeConnectInput, config: LocalAgentRuntime, cwd: string) {
  const { CodexSessionHost } = await import('./CodexSessionHost')
  const host = new CodexSessionHost(input.sessionId, input.agentId, config, input.localTarget, input.headless)
  const restore = input.resumeToken
    ? {
        threadId: input.resumeToken,
        kind:
          !input.nativeSessionId && !agentSessionMessageService.hasSessionMessages(input.sessionId)
            ? ('empty-prewarm' as const)
            : ('required' as const)
      }
    : undefined
  return withStartupSignal(
    AbortSignal.timeout(30_000),
    () => host.start(cwd, restore, input.branchHead),
    () => host.close()
  )
}

export function listModels(config: LocalAgentConfiguration) {
  return listCodexModels({ ...config, nativeModel: undefined }, application.getPath('cherry.bin'))
}

export function check(config: LocalAgentConfiguration) {
  return checkCodex(config, application.getPath('cherry.bin'))
}

export function bindAccount(config: LocalAgentConfiguration): RuntimeAccountAccess {
  const launch = (signal: AbortSignal) =>
    resolveCodexLaunch(config, application.getPath('cherry.bin'), signal, 'models')
  return {
    async readAccount(signal) {
      return readCodexAccount(await launch(signal), codexProcessHost, signal)
    },
    async readSubscriptionUsage(signal) {
      if (config.sourceModelViaGateway) return { status: 'unsupported' }
      return readCodexSubscriptionUsage(await launch(signal), codexProcessHost, signal)
    }
  }
}
