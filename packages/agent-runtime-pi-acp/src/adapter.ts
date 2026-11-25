import * as z from 'zod'

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
