import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

import { WorkspaceEditDialog } from '../WorkspaceEditDialog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const workspace: AgentWorkspaceEntity = {
  id: 'workspace',
  name: 'Original',
  path: '/main',
  additionalDirectories: ['/extra'],
  type: 'user',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

afterEach(() => {
  cleanup()
  MockUseDataApiUtils.resetMocks()
  vi.restoreAllMocks()
})

describe('WorkspaceEditDialog', () => {
  it('saves a renamed workspace with its selected main directory and remaining directories', async () => {
    const save = vi.spyOn(ipcApi, 'request').mockResolvedValue(workspace)
    const user = userEvent.setup()
    render(<WorkspaceEditDialog workspace={workspace} onClose={vi.fn()} />)
    await user.clear(screen.getByRole('textbox', { name: 'common.name' }))
    await user.type(screen.getByRole('textbox', { name: 'common.name' }), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'agent.session.workspace_edit.set_main' }))
    await user.click(screen.getByRole('button', { name: 'common.save' }))
    expect(save).toHaveBeenCalledWith('ai.agent.workspace.update', {
      workspaceId: 'workspace',
      changes: { name: 'Renamed', path: '/extra', additionalDirectories: ['/main'] }
    })
  })

  it('keeps edited values available for retry after a save failure', async () => {
    vi.spyOn(ipcApi, 'request').mockRejectedValue(new Error('failed'))
    const user = userEvent.setup()
    const close = vi.fn()
    render(<WorkspaceEditDialog workspace={workspace} onClose={close} />)
    await user.type(screen.getByRole('textbox', { name: 'common.name' }), ' changed')
    await user.click(screen.getByRole('button', { name: 'common.save' }))
    expect(screen.getByRole('textbox', { name: 'common.name' })).toHaveValue('Original changed')
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'agent.session.workspace_edit.main_directory' })).toBeDisabled()
  })
})
