import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentWorkspaceUnavailableNotice } from '../AgentWorkspaceUnavailableNotice'

const { requestMock, invalidateMock, selectFolderMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  invalidateMock: vi.fn(),
  selectFolderMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/data/hooks/useDataApi', () => ({ useInvalidateCache: () => invalidateMock }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('AgentWorkspaceUnavailableNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { file: { selectFolder: selectFolderMock } }
    })
  })

  it('keeps the agent recoverable when the folder picker is cancelled', async () => {
    const onWorkspaceChange = vi.fn()
    selectFolderMock.mockResolvedValueOnce(null)
    render(<AgentWorkspaceUnavailableNotice workspacePath="/missing/dir" onWorkspaceChange={onWorkspaceChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.session.workspace_unavailable.choose' }))

    await waitFor(() => expect(selectFolderMock).toHaveBeenCalled())
    expect(requestMock).not.toHaveBeenCalled()
    expect(onWorkspaceChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'agent.session.workspace_unavailable.choose' })).toBeEnabled()
  })

  it('registers the chosen folder and rebinds the agent to it', async () => {
    const onWorkspaceChange = vi.fn()
    selectFolderMock.mockResolvedValueOnce('/new/dir')
    requestMock.mockResolvedValueOnce({ id: 'workspace-new', path: '/new/dir' })
    render(<AgentWorkspaceUnavailableNotice workspacePath="/missing/dir" onWorkspaceChange={onWorkspaceChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.session.workspace_unavailable.choose' }))

    await waitFor(() => expect(onWorkspaceChange).toHaveBeenCalledWith('workspace-new'))
    expect(requestMock).toHaveBeenCalledWith('ai.agent.workspace.register', { path: '/new/dir' })
    expect(invalidateMock).toHaveBeenCalledWith('/agent-workspaces')
  })
})
