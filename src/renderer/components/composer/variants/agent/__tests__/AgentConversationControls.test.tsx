import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'

import { AgentConversationControls, type AgentConversationControlsProps } from '../AgentConversationControls'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

// The catalog fetch is irrelevant to these controls; render the trigger directly.
vi.mock('@renderer/components/resourceCatalog/selectors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WorkspaceSelector: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>
}))

const workspace = { id: 'workspace-1', type: 'user', name: 'My workspace', path: '/projects/my-workspace' } as const

function renderControls(workspace: AgentConversationControlsProps['workspace']) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AgentConversationControls
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
      />
    </SWRConfig>
  )
}

describe('locked conversation workspace', () => {
  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
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
})

describe('workspace picker busy state', () => {
  beforeEach(async () => {
    MockUseCacheUtils.resetMocks()
    await i18n.changeLanguage('en-US')
    // The workspace picker fetches its catalog; an empty list is enough here.
    vi.mocked(window.api.ipcApi.request).mockReset()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: [] })
  })

  it('disables the picker with the reason while a turn is in flight', () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <AgentConversationControls
          workspace={workspace}
          workspaceId={workspace.id}
          workspaceDisabledReason="A task is running. Change the work directory when it finishes."
          selectAgentLabel="Select agent"
          selectModelLabel="Select model"
          selectWorkspaceLabel="Select workspace"
          shouldAutoSelectCreatedAgent={false}
          side="bottom"
          agentTriggerMode="edit"
          canChangeModel={false}
          onAgentChange={vi.fn()}
          onModelSelect={vi.fn()}
          onWorkspaceChange={vi.fn()}
        />
      </SWRConfig>
    )

    const picker = screen.getByRole('button', { name: 'My workspace' })
    expect(picker).toBeDisabled()
    expect(picker).toHaveAttribute('title', 'A task is running. Change the work directory when it finishes.')
  })
})
