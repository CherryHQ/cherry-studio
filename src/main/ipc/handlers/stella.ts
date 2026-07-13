import { agentService } from '@data/services/AgentService'
import { stellaClient } from '@main/ai/runtime/stella/StellaClient'
import { stellaConnectionService } from '@main/ai/runtime/stella/StellaConnectionService'
import type { stellaRequestSchemas } from '@shared/ipc/schemas/stella'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Stella calls stay command IPC: they have network side effects and no SQLite resource. */
export const stellaHandlers: IpcHandlersFor<typeof stellaRequestSchemas> = {
  'stella.configure_connection': async ({ endpoint, pat }) => {
    // Verify before replacing the sole stored account so a typo cannot strand existing agents.
    const tested = await stellaClient.testConnection(endpoint, pat)
    const current = stellaConnectionService.getInfo()
    const hasReferences = agentService.listAgents().agents.some((agent) => agent.type === 'stella')
    if (current && current.endpoint !== tested.endpoint && hasReferences) {
      throw new Error('Remove existing Stella agent references before connecting a different Stella server')
    }
    return stellaConnectionService.configure(tested.endpoint, pat)
  },
  'stella.list_agents': () => stellaClient.listAgents()
}
