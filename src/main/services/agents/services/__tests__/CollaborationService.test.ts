import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { CollaborationService } from '../CollaborationService'

function selectRowsOnce(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows)
      })),
      orderBy: vi.fn().mockResolvedValue(rows)
    }))
  }
}

describe('CollaborationService', () => {
  const service = CollaborationService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a workspace and returns the persisted row', async () => {
    const inserted: Record<string, unknown>[] = []
    const database = {
      insert: vi.fn(() => ({
        values: vi.fn(async (row) => {
          inserted.push(row)
        })
      })),
      select: vi.fn().mockReturnValueOnce(
        selectRowsOnce([
          {
            id: 'workspace-1',
            name: 'Main Workspace',
            rootPaths: ['/tmp'],
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:00.000Z'
          }
        ])
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const workspace = await service.createWorkspace({
      name: 'Main Workspace',
      rootPaths: ['/tmp']
    })

    expect(database.insert).toHaveBeenCalledTimes(1)
    expect(inserted[0]).toMatchObject({
      name: 'Main Workspace',
      rootPaths: ['/tmp']
    })
    expect(workspace.name).toBe('Main Workspace')
  })

  it('creates a room message and updates room activity timestamp', async () => {
    const insertedMessages: Record<string, unknown>[] = []
    const roomUpdates: Record<string, unknown>[] = []
    const database = {
      insert: vi.fn(() => ({
        values: vi.fn(async (row) => {
          insertedMessages.push(row)
        })
      })),
      update: vi.fn(() => ({
        set: vi.fn((row) => ({
          where: vi.fn(async () => {
            roomUpdates.push(row)
          })
        }))
      })),
      select: vi.fn().mockReturnValueOnce(
        selectRowsOnce([
          {
            id: 'message-1',
            roomId: 'room-1',
            authorType: 'user',
            kind: 'task',
            intent: 'task',
            routing: 'elite',
            content: 'Ship it',
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:00.000Z'
          }
        ])
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const message = await service.createRoomMessage({
      roomId: 'room-1',
      authorType: 'user',
      intent: 'task',
      routing: 'elite',
      content: 'Ship it'
    })

    expect(insertedMessages[0]).toMatchObject({
      roomId: 'room-1',
      kind: 'task',
      intent: 'task',
      routing: 'elite',
      content: 'Ship it'
    })
    expect(roomUpdates).toHaveLength(1)
    expect(roomUpdates[0]).toEqual(expect.objectContaining({ lastActivityAt: expect.any(String) }))
    expect(message.intent).toBe('task')
  })

  it('merges room autonomy config into room metadata', async () => {
    const updates: Record<string, unknown>[] = []
    const database = {
      update: vi.fn(() => ({
        set: vi.fn((row) => ({
          where: vi.fn(async () => {
            updates.push(row)
          })
        }))
      })),
      select: vi
        .fn()
        .mockReturnValueOnce(
          selectRowsOnce([
            {
              id: 'room-1',
              workspaceId: 'workspace-1',
              title: '讨论组',
              status: 'todo',
              metadata: {
                autonomy: {
                  enabled: false,
                  idleMinutes: 30,
                  paused: false
                }
              },
              createdAt: '2026-05-07T00:00:00.000Z',
              updatedAt: '2026-05-07T00:00:00.000Z',
              lastActivityAt: '2026-05-07T00:00:00.000Z'
            }
          ])
        )
        .mockReturnValueOnce(
          selectRowsOnce([
            {
              id: 'room-1',
              workspaceId: 'workspace-1',
              title: '讨论组',
              status: 'todo',
              metadata: {
                autonomy: {
                  enabled: true,
                  idleMinutes: 45,
                  paused: false,
                  routerAgentId: 'agent-router'
                }
              },
              createdAt: '2026-05-07T00:00:00.000Z',
              updatedAt: '2026-05-07T00:00:00.000Z',
              lastActivityAt: '2026-05-07T00:00:00.000Z'
            }
          ])
        )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const room = await service.updateRoomAutonomy('room-1', {
      enabled: true,
      idleMinutes: 45,
      routerAgentId: 'agent-router'
    })

    expect(updates[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          autonomy: expect.objectContaining({
            enabled: true,
            idleMinutes: 45,
            routerAgentId: 'agent-router'
          })
        })
      })
    )
    expect(room?.autonomy.enabled).toBe(true)
    expect(room?.autonomy.idleMinutes).toBe(45)
  })

  it('removes a room member and refreshes room activity', async () => {
    const touchUpdates: Record<string, unknown>[] = []
    const database = {
      delete: vi.fn(() => ({
        where: vi.fn(async () => ({ rowsAffected: 1 }))
      })),
      update: vi.fn(() => ({
        set: vi.fn((row) => ({
          where: vi.fn(async () => {
            touchUpdates.push(row)
          })
        }))
      }))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const removed = await service.removeRoomMember('room-1', 'agent', 'agent-1')

    expect(removed).toBe(true)
    expect(database.delete).toHaveBeenCalledTimes(1)
    expect(touchUpdates[0]).toEqual(expect.objectContaining({ lastActivityAt: expect.any(String) }))
  })
})
