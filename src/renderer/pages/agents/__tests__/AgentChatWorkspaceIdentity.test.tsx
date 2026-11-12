import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren, ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import type { CherryUIMessage } from '@shared/data/types/message'

import AgentChat from '../AgentChat'
import type { AgentConversationBootstrap } from '../useAgentConversationBootstrap'

const history = vi.hoisted(() => ({ messages: [] as CherryUIMessage[], refresh: vi.fn() }))
const defaultQuery = mockUseQuery.getMockImplementation()!

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({ topBar }: { topBar?: ReactNode }) => <header>{topBar}</header>
}))

vi.mock('../components/AgentRightPane', () => ({
  AgentRightPane: {
    Scope: ({ children }: PropsWithChildren) => <>{children}</>,
    DetailsLayout: ({ children }: PropsWithChildren) => <>{children}</>,
    Viewport: () => null,
    Shortcuts: () => null
  },
  AgentTaskProgressCapsule: () => null,
  useOptionalAgentRightPaneActions: () => undefined
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages: history.messages,
    persistedPartsByMessageId: {},
    isLoading: false,
    hasOlder: false,
    refresh: history.refresh
  })
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({ activeExecutions: [], sendMessage: vi.fn(), stop: vi.fn() })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({ overlay: {}, liveAssistants: [], disposeOverlay: vi.fn(), reset: vi.fn() })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: () => {}
}))

vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({
  useAgentWorkspaceWarning: () => undefined
}))

const timestamp = '2026-11-11T00:00:00.000Z'
const workspace = {
  id: 'workspace-1',
  type: 'user' as const,
  name: 'My workspace',
  path: '/projects/my-workspace',
  orderKey: 'a0',
  createdAt: timestamp,
  updatedAt: timestamp
}
const nextWorkspace = { ...workspace, id: 'workspace-2', name: 'Other workspace', path: '/projects/other-workspace' }
const bootstrap: AgentConversationBootstrap = {
  session: {
    id: 'session-1',
    agentId: 'agent-1',
    runtimeType: 'pi-durable',
    name: 'Workspace conversation',
    isNameManuallyEdited: false,
    workspaceId: workspace.id,
    workspace,
    orderKey: 'a0',
    lastActivityAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  },
  sessionLoading: false,
  sessionSource: 'query',
  resources: {
    agent: {
      id: 'agent-1',
      name: 'My agent',
      type: 'claude-code',
      model: null,
      modelName: null,
      orderKey: 'a0',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    agentLoading: false,
    modelLoading: false
  }
}

function renderConversation(onSessionWorkspaceChange: (workspaceId: string | null) => void) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AgentChat
        conversationBootstrap={bootstrap}
        onSessionWorkspaceChange={onSessionWorkspaceChange}
        showResourceListControls={false}
      />
    </SWRConfig>
  )
}

describe('AgentChat top-bar workspace identity', () => {
  beforeEach(async () => {
    HTMLElement.prototype.scrollIntoView = () => {}
    history.messages = []
    history.refresh.mockReset()
    MockUseCacheUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    mockUseQuery.mockImplementation((path, options) => {
      const result = defaultQuery(path, options)
      return path === '/agent-workspaces' ? { ...result, data: [workspace, nextWorkspace] } : result
    })
    await i18n.changeLanguage('en-US')
    vi.mocked(window.api.ipcApi.request).mockReset()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: { pathKind: 'directory', targets: [{ id: 'file_manager', kind: 'file_manager' }] }
    })
  })

  it('keeps the folder and workspace name in the non-empty conversation top bar as a directory opener', async () => {
    history.messages = [
      {
        id: 'message-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
        metadata: { createdAt: timestamp, status: 'success' }
      }
    ]
    const user = userEvent.setup()
    const onSessionWorkspaceChange = vi.fn()
    renderConversation(onSessionWorkspaceChange)

    const topBar = within(screen.getByRole('banner'))
    const openWorkspace = topBar.getByRole('button', { name: workspace.name })
    expect(within(openWorkspace).getByText(workspace.name)).toBeVisible()
    // The folder glyph is part of the workspace identity contract.
    expect(openWorkspace.querySelector('svg.lucide-folder')).toBeInTheDocument()
    expect(openWorkspace).not.toHaveAttribute('aria-haspopup')
    expect(topBar.queryByTestId('clear-workspace-button')).not.toBeInTheDocument()
    await waitFor(() => expect(openWorkspace).toBeEnabled())
    await user.click(openWorkspace)

    expect(window.api.ipcApi.request).toHaveBeenCalledWith('external_app.target.open', {
      targetPath: workspace.path,
      pathKind: 'directory',
      targetId: 'file_manager'
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSessionWorkspaceChange).not.toHaveBeenCalled()
  })

  it('keeps workspace selection available for a settled empty conversation', async () => {
    const user = userEvent.setup()
    const onSessionWorkspaceChange = vi.fn()
    renderConversation(onSessionWorkspaceChange)

    const topBar = within(screen.getByRole('banner'))
    const selectWorkspace = topBar.getByRole('button', { name: workspace.name })
    expect(selectWorkspace).toBeEnabled()
    expect(topBar.getByTestId('clear-workspace-button')).toBeInTheDocument()
    await user.click(selectWorkspace)

    const workspaces = await screen.findByRole('listbox')
    await user.click(within(workspaces).getByRole('option', { name: nextWorkspace.name }))

    expect(onSessionWorkspaceChange).toHaveBeenCalledWith(nextWorkspace.id)
    expect(window.api.ipcApi.request).not.toHaveBeenCalledWith('external_app.target.open', expect.anything())
  })
})
