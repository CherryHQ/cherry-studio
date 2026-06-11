import { SuccessStatus } from '@shared/data/api/apiTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listMock,
  findOrCreateByPathResultMock,
  getByIdMock,
  updateMock,
  deleteWorkspaceCascadeMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  findOrCreateByPathResultMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteWorkspaceCascadeMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/AgentWorkspaceService', () => ({
  agentWorkspaceService: {
    list: listMock,
    findOrCreateByPathResult: findOrCreateByPathResultMock,
    getById: getByIdMock,
    update: updateMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    deleteWorkspaceCascade: deleteWorkspaceCascadeMock
  }
}))

import { agentWorkspaceHandlers } from '../agentWorkspaces'

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user' as const,
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('agentWorkspaceHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates list and get to AgentWorkspaceService', async () => {
    listMock.mockResolvedValueOnce([workspace])
    getByIdMock.mockResolvedValueOnce(workspace)

    await expect(agentWorkspaceHandlers['/agent-workspaces'].GET({} as never)).resolves.toEqual([workspace])
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].GET({
        params: { workspaceId: workspace.id }
      } as never)
    ).resolves.toBe(workspace)

    expect(listMock).toHaveBeenCalledOnce()
    expect(getByIdMock).toHaveBeenCalledWith(workspace.id)
  })

  it('delegates create and update to AgentWorkspaceService', async () => {
    findOrCreateByPathResultMock.mockResolvedValueOnce({ workspace, created: true })
    updateMock.mockResolvedValueOnce({ ...workspace, name: 'Renamed' })

    await expect(
      agentWorkspaceHandlers['/agent-workspaces'].POST({
        body: { path: workspace.path, name: workspace.name }
      } as never)
    ).resolves.toEqual({ data: workspace, status: SuccessStatus.CREATED })
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].PATCH({
        params: { workspaceId: workspace.id },
        body: { name: 'Renamed' }
      } as never)
    ).resolves.toMatchObject({ name: 'Renamed' })

    expect(findOrCreateByPathResultMock).toHaveBeenCalledWith(workspace.path, { name: workspace.name })
    expect(updateMock).toHaveBeenCalledWith(workspace.id, { name: 'Renamed' })
  })

  it('returns 200 OK when POST finds an existing workspace', async () => {
    findOrCreateByPathResultMock.mockResolvedValueOnce({ workspace, created: false })

    await expect(
      agentWorkspaceHandlers['/agent-workspaces'].POST({
        body: { path: workspace.path, name: 'Ignored Rename' }
      } as never)
    ).resolves.toEqual({ data: workspace, status: SuccessStatus.OK })
  })

  it('rejects invalid create body before calling the service', async () => {
    await expect(
      agentWorkspaceHandlers['/agent-workspaces'].POST({
        body: { name: workspace.name }
      } as never)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(findOrCreateByPathResultMock).not.toHaveBeenCalled()
  })

  it('rejects invalid update body before calling the service', async () => {
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].PATCH({
        params: { workspaceId: workspace.id },
        body: {}
      } as never)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('delegates workspace deletion cascade to AgentSessionService', async () => {
    deleteWorkspaceCascadeMock.mockResolvedValueOnce(undefined)

    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].DELETE({
        params: { workspaceId: workspace.id }
      } as never)
    ).resolves.toBeUndefined()

    expect(deleteWorkspaceCascadeMock).toHaveBeenCalledWith(workspace.id)
  })

  it('delegates order mutations', async () => {
    reorderMock.mockResolvedValueOnce(undefined)
    reorderBatchMock.mockResolvedValueOnce(undefined)

    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:id/order'].PATCH({
        params: { id: workspace.id },
        body: { position: 'first' }
      } as never)
    ).resolves.toBeUndefined()
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/order:batch'].PATCH({
        body: { moves: [{ id: workspace.id, anchor: { position: 'last' } }] }
      } as never)
    ).resolves.toBeUndefined()

    expect(reorderMock).toHaveBeenCalledWith(workspace.id, { position: 'first' })
    expect(reorderBatchMock).toHaveBeenCalledWith([{ id: workspace.id, anchor: { position: 'last' } }])
  })
})
