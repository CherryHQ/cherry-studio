import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listMock,
  findOrCreateByPathMock,
  getByIdMock,
  getRowByIdTxMock,
  updateMock,
  deleteByWorkspaceTxMock,
  deleteByIdTxMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  findOrCreateByPathMock: vi.fn(),
  getByIdMock: vi.fn(),
  getRowByIdTxMock: vi.fn(),
  updateMock: vi.fn(),
  deleteByWorkspaceTxMock: vi.fn(),
  deleteByIdTxMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

import { application } from '@application'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'

vi.mock('@data/services/AgentWorkspaceService', () => ({
  agentWorkspaceService: {
    list: listMock,
    findOrCreateByPath: findOrCreateByPathMock,
    getById: getByIdMock,
    getRowByIdTx: getRowByIdTxMock,
    update: updateMock,
    deleteByIdTx: deleteByIdTxMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    deleteByWorkspaceTx: deleteByWorkspaceTxMock
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
    MockMainDbServiceUtils.resetMocks()
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
    findOrCreateByPathMock.mockResolvedValueOnce(workspace)
    updateMock.mockResolvedValueOnce({ ...workspace, name: 'Renamed' })

    await expect(
      agentWorkspaceHandlers['/agent-workspaces'].POST({
        body: { path: workspace.path, name: workspace.name }
      } as never)
    ).resolves.toBe(workspace)
    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].PATCH({
        params: { workspaceId: workspace.id },
        body: { name: 'Renamed' }
      } as never)
    ).resolves.toMatchObject({ name: 'Renamed' })

    expect(findOrCreateByPathMock).toHaveBeenCalledWith(workspace.path, { name: workspace.name })
    expect(updateMock).toHaveBeenCalledWith(workspace.id, { name: 'Renamed' })
  })

  it('rejects invalid create body before calling the service', async () => {
    await expect(
      agentWorkspaceHandlers['/agent-workspaces'].POST({
        body: { name: workspace.name }
      } as never)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(findOrCreateByPathMock).not.toHaveBeenCalled()
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

  it('deletes a user workspace and its sessions in one transaction', async () => {
    const tx = MockMainDbServiceUtils.getDefaultMockDb()
    getRowByIdTxMock.mockResolvedValueOnce(workspace)
    deleteByWorkspaceTxMock.mockResolvedValueOnce(['session-1'])
    deleteByIdTxMock.mockResolvedValueOnce(undefined)

    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].DELETE({
        params: { workspaceId: workspace.id }
      } as never)
    ).resolves.toBeUndefined()

    expect(application.get('DbService').withWriteTx).toHaveBeenCalledOnce()
    expect(getRowByIdTxMock).toHaveBeenCalledWith(tx, workspace.id)
    expect(deleteByWorkspaceTxMock).toHaveBeenCalledWith(tx, workspace.id)
    expect(deleteByIdTxMock).toHaveBeenCalledWith(tx, workspace.id)
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
