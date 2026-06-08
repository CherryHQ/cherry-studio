import { toDataApiError } from '@shared/data/api'
import { CreateAgentSessionSchema } from '@shared/data/api/schemas/agentSessions'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { agentSessionCreationService } from './AgentSessionCreationService'

export function registerAgentSessionIpcHandlers(): void {
  ipcMain.handle(IpcChannel.AgentSession_Create, async (_, rawDto: unknown) => {
    const parsed = CreateAgentSessionSchema.safeParse(rawDto)
    if (!parsed.success) throw toDataApiError(parsed.error)
    return await agentSessionCreationService.createSession(parsed.data)
  })
}
