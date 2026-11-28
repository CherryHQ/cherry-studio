import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'

import { AgentConversationControls, type AgentConversationControlsProps } from '../AgentConversationControls'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const workspace = { id: 'workspace-1', type: 'user', name: 'My workspace', path: '/projects/my-workspace' } as const

function renderControls(
  workspace: AgentConversationControlsProps['workspace'],
  agent?: AgentConversationControlsProps['agent'],
  onAvatarClick?: AgentConversationControlsProps['onAvatarClick']
) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AgentConversationControls
        agent={agent}
        workspace={workspace}
        workspaceId={workspace?.id}
        selectAgentLabel="Select agent"
        selectModelLabel="Select model"
        selectWorkspaceLabel="Select workspace"
        shouldAutoSelectCreatedAgent={false}
        side="bottom"
        agentTriggerMode="edit"
        canChangeModel={false}
        onAgentChange={vi.fn()}
        onModelSelect={vi.fn()}
        onAvatarClick={onAvatarClick}
      />
    </SWRConfig>
  )
}

describe('locked conversation workspace', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
    mockUseQuery.mockImplementation((path) => ({
      data: path === '/providers' || path === '/models' ? [] : undefined,
      isLoading: false,
      isRefreshing: false,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    await i18n.changeLanguage('en-US')
    vi.mocked(window.api.ipcApi.request).mockReset()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: {
        pathKind: 'directory',
        targets: [{ id: 'file_manager', kind: 'file_manager' }]
      }
    })
  })

  it('retains the user workspace folder and name and opens its directory without selection or clearing', async () => {
    const user = userEvent.setup()
    renderControls(workspace)

    const openWorkspace = screen.getByRole('button', { name: 'My workspace' })
    // The folder glyph is part of the workspace identity contract.
    expect(openWorkspace.querySelector('svg.lucide-folder')).toBeInTheDocument()
    expect(screen.queryByTestId('clear-workspace-button')).not.toBeInTheDocument()
    expect(openWorkspace).not.toHaveAttribute('aria-haspopup')
    await waitFor(() => expect(openWorkspace).toBeEnabled())
    await user.click(openWorkspace)

    expect(window.api.ipcApi.request).toHaveBeenCalledWith('external_app.target.open', {
      targetPath: '/projects/my-workspace',
      pathKind: 'directory',
      targetId: 'file_manager'
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('labels a system workspace as no work directory without a user-folder opener', () => {
    renderControls({ id: 'system-workspace', type: 'system', name: 'Internal workspace', path: '/internal/system' })

    const noProject = screen.getByRole('button', { name: 'No work directory' })
    expect(noProject).toBeDisabled()
    expect(noProject.querySelector('svg.lucide-circle-slash')).toBeInTheDocument()
    expect(noProject.querySelector('svg.lucide-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('clear-workspace-button')).not.toBeInTheDocument()
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
  })

  it('labels a local agent system workspace as no work directory without a user-folder opener', () => {
    renderControls({ id: 'system-workspace', type: 'system', name: 'Internal workspace', path: '/internal/system' }, {
      id: 'local-agent-1',
      name: 'Claude Code',
      type: 'local'
    } as NonNullable<AgentConversationControlsProps['agent']>)

    const noProject = screen.getByRole('button', { name: 'No work directory' })
    expect(noProject).toBeDisabled()
    expect(noProject.querySelector('svg.lucide-circle-slash')).toBeInTheDocument()
    expect(noProject.querySelector('svg.lucide-folder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('clear-workspace-button')).not.toBeInTheDocument()
    expect(window.api.ipcApi.request).not.toHaveBeenCalled()
  })

  it('renders the local CLI’s artwork on the avatar that opens the conversation profile', async () => {
    const openProfile = vi.fn()
    renderControls(
      workspace,
      {
        id: 'local-codex',
        name: 'Codex',
        type: 'local',
        model: null,
        modelName: null,
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        localRuntime: { providerId: 'codex-provider', presetId: 'codex', enabled: true, args: [], env: {} }
      },
      openProfile
    )

    const avatar = screen.getByRole('button', { name: i18n.t('chat.profile_pane.open', { name: 'Codex' }) })
    expect(avatar.querySelector('[data-slot="cli-icon"] svg')).toBeInTheDocument()
    await userEvent.click(avatar)
    expect(openProfile).toHaveBeenCalledOnce()
  })
})
