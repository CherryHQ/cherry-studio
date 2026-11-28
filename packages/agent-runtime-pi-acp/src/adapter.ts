import * as z from 'zod'

import { type AcpJsonModelProfile } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

import { bindPiContextUsage } from './contextUsage'

const startup = z.object({ piAcp: z.object({ startupInfo: z.string().min(1) }) })

export const piAcpAdapter: Required<Pick<AcpHarnessAdapter, 'bind' | 'setupUpdate'>> = {
  setupUpdate: 'agent_message_chunk',
  bind({ agentCapabilities, agent, sessionId, newSessionMetadata, currentModel }) {
    let banner = startup.safeParse(newSessionMetadata).data?.piAcp.startupInfo
    const context = bindPiContextUsage(agentCapabilities?._meta, agent, sessionId, currentModel)
    return {
      ...context,
      consumeAssistantText(text) {
        if (text !== banner) return false
        banner = undefined
        return true
      }
    }
  }
}

export const piModelProfile = {
  format: 'json',
  target: 'pi-settings',
  readModel({ defaultProvider, defaultModel }) {
    return typeof defaultProvider === 'string' && defaultProvider && typeof defaultModel === 'string' && defaultModel
      ? `${defaultProvider}/${defaultModel}`
      : undefined
  },
  writeModel(_doc, model, invalidModel) {
    const slash = model?.indexOf('/') ?? -1
    if (model && (slash < 1 || slash === model.length - 1)) return invalidModel()
    return [
      [['defaultProvider'], model?.slice(0, slash)],
      [['defaultModel'], model?.slice(slash + 1)]
    ]
  }
} satisfies AcpJsonModelProfile<'pi-settings'>

const nodeRuntime = { executable: 'node', minimumVersion: '20.0.0', label: 'Node.js', major: '20' } as const

export async function preparePiAcpLaunch<Source extends string>(
  command: { executable: string; args: readonly string[]; env: Record<string, string> },
  host: {
    requireRuntime(
      runtime: typeof nodeRuntime,
      env: Record<string, string>
    ): Promise<{ path: string; source: Source; env: Record<string, string> }>
    bridgeEntry(): string
  }
) {
  const node = await host.requireRuntime(nodeRuntime, command.env)
  return {
    executable: node.path,
    source: node.source,
    args: [host.bridgeEntry(), ...command.args],
    env: { ...node.env, PI_ACP_PI_COMMAND: command.env.PI_ACP_PI_COMMAND || command.executable }
  }
}
