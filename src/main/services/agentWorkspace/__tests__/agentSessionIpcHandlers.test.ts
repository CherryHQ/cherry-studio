import { ErrorCode } from '@shared/data/api'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerAgentSessionIpcHandlers } from '../agentSessionIpcHandlers'
import { agentSessionWorkflowService } from '../AgentSessionWorkflowService'

vi.mock('../AgentSessionWorkflowService', () => ({
  agentSessionWorkflowService: {
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
    vi.mocked(agentSessionWorkflowService.createSession).mockReset()
  })

  it('rejects invalid create payloads before calling the workflow service', async () => {
    const handler = getCreateHandler()

    await expect(handler({} as never, { agentId: '', name: '' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
    expect(agentSessionWorkflowService.createSession).not.toHaveBeenCalled()
  })

  it('validates and forwards create payloads to the workflow service', async () => {
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
    vi.mocked(agentSessionWorkflowService.createSession).mockResolvedValueOnce(session as never)
    const handler = getCreateHandler()

    await expect(
      handler({} as never, {
        agentId: 'agent-1',
        name: 'Session',
        workspaceId: 'workspace-1'
      })
    ).resolves.toBe(session)
    expect(agentSessionWorkflowService.createSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'Session',
      workspaceId: 'workspace-1'
    })
  })
})
