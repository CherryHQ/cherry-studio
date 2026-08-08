import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  closeConversationTabsMock,
  createWorkspaceMock,
  deleteWorkspaceMock,
  refetchWorkspacesMock,
  selectFolderMock,
  toastSuccessMock,
  useMutationMock,
  useQueryMock,
  useRawAgentSessionsSourceMock
} = vi.hoisted(() => ({
  closeConversationTabsMock: vi.fn(),
  createWorkspaceMock: vi.fn(),
  deleteWorkspaceMock: vi.fn(),
  refetchWorkspacesMock: vi.fn(),
  selectFolderMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
  useRawAgentSessionsSourceMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/resourceViewSources', () => ({
  useRawAgentSessionsSource: useRawAgentSessionsSourceMock
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => closeConversationTabsMock
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: vi.fn(),
    success: toastSuccessMock
  }
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { count?: number; name?: string }) => {
        const translations: Record<string, string> = {
          'agent.session.new': 'New task',
          'agent.session.workdir.delete.disk_preserved': 'The folder on disk and its files will not be deleted.',
          'agent.session.workdir.delete.empty': 'This work directory has no related sessions.',
          'agent.session.workdir.delete.preview': `The sessions below will also be deleted with “${options?.name}”.`,
          'agent.session.workdir.delete.preview_failed': 'Related sessions could not be loaded',
          'agent.session.workdir.delete.preview_loading': 'Loading related sessions…',
          'agent.session.workdir.delete.sessions_count': `${options?.count} sessions`,
          'agent.session.workdir.delete.sessions_title': 'Sessions to be deleted',
          'agent.session.workdir.delete.title': 'Delete work directory',
          'agent.session.workdir.delete.trigger': 'Delete work directory',
          'agent.session.workspace_selector.create_failed': 'Failed to add work directory',
          'agent.session.workspace_selector.create_new': 'Add new work directory',
          'agent.session.workspace_selector.empty_text': 'No work directories',
          'agent.session.workspace_selector.no_project': 'No work directory',
          'agent.session.workspace_selector.search_placeholder': 'Search work directories',
          'agent.session.workspace_selector.select_failed': 'Failed to select folder',
          'common.cancel': 'Cancel',
          'common.delete': 'Delete',
          'common.delete_success': 'Deleted'
        }
        return translations[key] ?? key
      }
    })
  }
})

import { WorkspaceSelector } from '../WorkspaceSelector'

const WORKSPACES = [
  {
    id: 'workspace-alpha',
    name: 'cherry-studio',
    path: '/Users/jd/cherry-studio',
    type: 'user',
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'workspace-beta',
    name: 'cherry-studio-1',
    path: '/Users/jd/projects/cherry-studio-1',
    type: 'user',
    orderKey: 'a1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  }
]

const CREATED_WORKSPACE = {
  id: 'workspace-created',
  name: 'new-project',
  path: '/Users/jd/new-project',
  type: 'user',
  orderKey: 'a2',
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z'
}

const SESSIONS = [
  {
    id: 'session-alpha-recent',
    agentId: 'agent-1',
    name: 'Fix workspace selector',
    isNameManuallyEdited: false,
    workspaceId: 'workspace-alpha',
    workspace: WORKSPACES[0],
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z'
  },
  {
    id: 'session-alpha-older',
    agentId: 'agent-1',
    name: 'Review delete dialog',
    isNameManuallyEdited: true,
    workspaceId: 'workspace-alpha',
    workspace: WORKSPACES[0],
    orderKey: 'a1',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z'
  },
  {
    id: 'session-beta',
    agentId: 'agent-1',
    name: 'Unrelated session',
    isNameManuallyEdited: false,
    workspaceId: 'workspace-beta',
    workspace: WORKSPACES[1],
    orderKey: 'a2',
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z'
  }
]

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  useQueryMock.mockReturnValue({
    data: WORKSPACES,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: refetchWorkspacesMock,
    mutate: vi.fn()
  })
  useMutationMock.mockImplementation((method: string, path: string) => {
    if (method === 'DELETE' && path === '/agent-workspaces/:workspaceId') {
      return {
        trigger: deleteWorkspaceMock,
        isLoading: false,
        error: undefined
      }
    }

    return {
      trigger: createWorkspaceMock,
      isLoading: false,
      error: undefined
    }
  })
  useRawAgentSessionsSourceMock.mockReturnValue({
    sessions: SESSIONS,
    isFullyLoaded: true,
    error: undefined
  })
  createWorkspaceMock.mockResolvedValue(CREATED_WORKSPACE)
  deleteWorkspaceMock.mockResolvedValue({ deletedIds: ['session-alpha-recent', 'session-alpha-older'] })
  refetchWorkspacesMock.mockResolvedValue(undefined)
  selectFolderMock.mockResolvedValue(null)

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      file: {
        selectFolder: selectFolderMock
      }
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderSelector(onChange = vi.fn()) {
  render(<WorkspaceSelector trigger={<button type="button">Open</button>} value={null} onChange={onChange} />)
  return { onChange }
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
}

describe('WorkspaceSelector', () => {
  it('loads workspaces and renders folder rows', () => {
    renderSelector()
    openPopover()

    expect(useQueryMock).toHaveBeenCalledWith('/agent-workspaces')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('cherry-studio')
    expect(options[1]).toHaveTextContent('cherry-studio-1')
    expect(screen.queryByText('/Users/jd/cherry-studio')).not.toBeInTheDocument()
  })

  it('renders and selects the no-project option', async () => {
    const onChange = vi.fn()
    render(
      <WorkspaceSelector trigger={<button type="button">Open</button>} value="workspace-alpha" onChange={onChange} />
    )
    openPopover()

    const addProjectButton = screen.getByRole('button', { name: 'Add new work directory' })
    const noProjectButton = screen.getByRole('button', { name: 'No work directory' })
    expect(addProjectButton.compareDocumentPosition(noProjectButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(noProjectButton)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
  })

  it('filters workspaces by name or path', () => {
    renderSelector()
    openPopover()

    fireEvent.change(screen.getByPlaceholderText('Search work directories'), { target: { value: 'projects' } })

    expect(screen.queryByRole('option', { name: /\/Users\/jd\/cherry-studio/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /cherry-studio-1/ })).toBeInTheDocument()
  })

  it('scrolls the selected workspace to the start when opened', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const onChange = vi.fn()
    render(
      <WorkspaceSelector
        trigger={<button type="button">Open</button>}
        value="workspace-beta"
        onChange={onChange}
        mountStrategy="lazy-keep"
      />
    )

    openPopover()

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
    scrollIntoView.mockRestore()
  })

  it('fires onChange with the selected workspace id', async () => {
    const { onChange } = renderSelector()
    openPopover()

    fireEvent.click(screen.getByText('cherry-studio-1'))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('workspace-beta'))
  })

  it('does nothing when the footer folder picker is canceled', async () => {
    const { onChange } = renderSelector()
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: 'Add new work directory' }))

    await waitFor(() =>
      expect(selectFolderMock).toHaveBeenCalledWith({ properties: ['openDirectory', 'createDirectory'] })
    )
    expect(createWorkspaceMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('creates and selects a workspace from the footer folder picker', async () => {
    selectFolderMock.mockResolvedValue('/Users/jd/new-project')
    const { onChange } = renderSelector()
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: 'Add new work directory' }))

    await waitFor(() =>
      expect(createWorkspaceMock).toHaveBeenCalledWith({
        body: { path: '/Users/jd/new-project' }
      })
    )
    expect(refetchWorkspacesMock).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith('workspace-created')
  })

  it('previews every affected session before deleting a workspace', async () => {
    const user = userEvent.setup()
    renderSelector()
    openPopover()

    await user.click(screen.getAllByRole('button', { name: 'Delete work directory' })[0])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('cherry-studio')
    expect(dialog).toHaveTextContent('2 sessions')
    expect(dialog).toHaveTextContent('Fix workspace selector')
    expect(dialog).toHaveTextContent('Review delete dialog')
    expect(dialog).not.toHaveTextContent('Unrelated session')
    expect(dialog).toHaveTextContent('/Users/jd/cherry-studio')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteWorkspaceMock).toHaveBeenCalledWith({ params: { workspaceId: 'workspace-alpha' } })
    )
    expect(closeConversationTabsMock).toHaveBeenCalledWith('agents', ['session-alpha-recent', 'session-alpha-older'])
    expect(toastSuccessMock).toHaveBeenCalledWith('Deleted')
  })

  it('loads the session impact only while the selector or delete dialog is open', () => {
    renderSelector()

    expect(useRawAgentSessionsSourceMock).toHaveBeenLastCalledWith({ enabled: false })
    openPopover()
    expect(useRawAgentSessionsSourceMock).toHaveBeenLastCalledWith({ enabled: true })
  })

  it('does not allow deletion before the complete session impact is loaded', () => {
    useRawAgentSessionsSourceMock.mockReturnValue({
      sessions: SESSIONS.slice(0, 1),
      isFullyLoaded: false,
      error: undefined
    })
    renderSelector()
    openPopover()

    expect(screen.getAllByRole('button', { name: 'Delete work directory' })[0]).toBeDisabled()
  })
})
