import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => vi.fn()
}))
vi.mock('@renderer/services/AppErrorDetailService', () => ({
  buildInlineErrorDetailRequest: (input: unknown) => input
}))
vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

import { WorkspaceDeleteConfirmDialog } from '../WorkspaceDeleteConfirmDialog'

const workspace = { id: 'ws-1', name: 'Desk', path: '/tmp/desk' } as AgentWorkspaceEntity
const emptyReferences = {
  sessions: { total: 0, items: [] },
  channels: { total: 0, items: [] },
  tasks: { total: 0, items: [] }
}

describe('WorkspaceDeleteConfirmDialog reference preview', () => {
  beforeEach(async () => {
    detailMocks.open.mockReset()
    MockUseDataApiUtils.resetMocks()
    await i18n.changeLanguage('en-US')
  })

  it('keeps retry for an empty preview failure and binds the workspace', async () => {
    const cause = new Error('references unavailable')
    const refetch = vi.fn()
    MockUseDataApiUtils.mockQueryResult('/agent-workspaces/:workspaceId/references', { error: cause, refetch })
    render(<WorkspaceDeleteConfirmDialog workspace={workspace} onDeleted={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText(i18n.t('agent.session.workdir.delete.preview_failed'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(refetch).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    await waitFor(() =>
      expect(detailMocks.open).toHaveBeenCalledWith(
        expect.objectContaining({
          error: cause,
          message: i18n.t('agent.session.workdir.delete.preview_failed'),
          source: 'agent.workspace',
          operation: 'workspace.references',
          recordId: 'ws-1'
        })
      )
    )
  })

  it('keeps retry when preview data and an error are both present', async () => {
    const cause = new Error('stale references')
    const refetch = vi.fn()
    MockUseDataApiUtils.mockQueryResult('/agent-workspaces/:workspaceId/references', {
      data: emptyReferences,
      error: cause,
      refetch
    })
    render(<WorkspaceDeleteConfirmDialog workspace={workspace} onDeleted={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText(i18n.t('agent.session.workdir.delete.disk_preserved'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    expect(refetch).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalledWith(expect.objectContaining({ error: cause })))
  })
})
