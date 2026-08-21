import { setAgentAvatar } from '@main/services/avatar'
import type { agentRequestSchemas } from '@shared/ipc/schemas/agent'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const agentHandlers: IpcHandlersFor<typeof agentRequestSchemas> = {
  'agent.set_avatar': async ({ agentId, avatar }) => setAgentAvatar(agentId, avatar)
}
