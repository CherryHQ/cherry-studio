import { ErrorCode } from '@shared/data/api'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionCreationService } from '../AgentSessionCreationService'
import { registerAgentSessionIpcHandlers } from '../agentSessionIpcHandlers'

vi.mock('../AgentSessionCreationService', () => ({
  agentSessionCreationService: {
    createSession: vi.fn()
  }
}))

function getCreateHandler() {
  registerAgentSessionIpcHandlers()
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === IpcChannel.AgentSession_Create)?.[1]
  if (!handler) throw new Error('AgentSession_Create handler was not registered')
  return handler
}

describe('agent session IPC handlers', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear()
    vi.mocked(agentSessionCreationService.createSession).mockReset()
  })

  it('rejects invalid create payloads before calling the creation service', async () => {
    const handler = getCreateHandler()

    await expect(handler({} as never, { agentId: '', name: '' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
    expect(agentSessionCreationService.createSession).not.toHaveBeenCalled()
  })

  it('validates and forwards create payloads to the creation service', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      workspaceId: 'workspace-1',
      workspace: null,
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    vi.mocked(agentSessionCreationService.createSession).mockResolvedValueOnce(session as never)
    const handler = getCreateHandler()

    await expect(
      handler({} as never, {
        agentId: 'agent-1',
        name: 'Session',
        workspaceId: 'workspace-1'
      })
    ).resolves.toBe(session)
    expect(agentSessionCreationService.createSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'Session',
      workspaceId: 'workspace-1'
    })
  })
})
