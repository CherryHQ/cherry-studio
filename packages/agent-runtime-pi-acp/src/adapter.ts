import * as z from 'zod'

import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

import { bindPiContextUsage } from './contextUsage'

const startup = z.object({ piAcp: z.object({ startupInfo: z.string().min(1) }) })

export const piAcpAdapter: Required<Pick<AcpHarnessAdapter, 'bind' | 'retainSetupUpdate'>> = {
  retainSetupUpdate: (update) => update.sessionUpdate === 'agent_message_chunk',
  bind({ agentCapabilities, agent, sessionId, newSessionMetadata, currentModel }) {
    let banner = startup.safeParse(newSessionMetadata).data?.piAcp.startupInfo
    const context = bindPiContextUsage(agentCapabilities?._meta, agent, sessionId, currentModel)
    return {
      ...context,
      consumeUpdate(update) {
        if (
          !banner ||
          update.sessionUpdate !== 'agent_message_chunk' ||
          update.content.type !== 'text' ||
          update.content.text !== banner
        )
          return false
        banner = undefined
        return true
      }
    }
  }
}
