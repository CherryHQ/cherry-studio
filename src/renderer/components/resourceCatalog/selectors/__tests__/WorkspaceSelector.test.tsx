import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const {
  closeConversationTabsMock,
  createWorkspaceMock,
  deleteWorkspaceMock,
  invalidateCacheMock,
  ipcRequestMock,
  refetchReferencesMock,
  refetchWorkspacesMock,
  selectFolderMock,
  toastErrorMock,
  toastSuccessMock,
  useMutationMock,
  useQueryMock
} = vi.hoisted(() => ({
  closeConversationTabsMock: vi.fn(),
  createWorkspaceMock: vi.fn(),
  deleteWorkspaceMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  ipcRequestMock: vi.fn(),
  refetchReferencesMock: vi.fn(),
  refetchWorkspacesMock: vi.fn(),
  selectFolderMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateCacheMock,
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => closeConversationTabsMock
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock, on: vi.fn(() => () => undefined) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: toastErrorMock,
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
          'agent.session.workdir.delete.channels_count': `${options?.count} channels`,
          'agent.session.workdir.delete.channels_empty': 'No channels will be changed.',
          'agent.session.workdir.delete.channels_title': 'Channels changed to no work directory',
          'agent.session.workdir.delete.disk_preserved': 'The folder on disk and its files will not be deleted.',
          'agent.session.workdir.delete.more_count': `…and ${options?.count} more items`,
          'agent.session.workdir.delete.preview': `Deleting “${options?.name}” shows every impact.`,
          'agent.session.workdir.delete.preview_failed': 'The deletion impact could not be loaded',
          'agent.session.workdir.delete.preview_loading': 'Loading deletion impact…',
          'agent.session.workdir.delete.sessions_count': `${options?.count} sessions`,
          'agent.session.workdir.delete.sessions_empty': 'No sessions will be deleted.',
          'agent.session.workdir.delete.sessions_title': 'Sessions to be deleted',
          'agent.session.workdir.delete.tasks_count': `${options?.count} scheduled tasks`,
          'agent.session.workdir.delete.tasks_empty': 'No scheduled tasks will be changed.',
          'agent.session.workdir.delete.tasks_title': 'Scheduled tasks changed to no work directory',
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
          'common.delete_success': 'Deleted',
          'common.retry': 'Retry',
          'common.unnamed': 'Unnamed'
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

const REFERENCES = {
  sessions: {
    items: SESSIONS.slice(0, 2).map(({ id, name }) => ({ id, name })),
    total: 5
  },
  channels: {
    items: [{ id: 'channel-alpha', name: 'Release bot' }],
    total: 1
  },
  tasks: {
    items: [{ id: 'task-alpha', name: 'Nightly review' }],
    total: 1
  }
}

let referencesQueryResult: {
  data: typeof REFERENCES | undefined
  isLoading: boolean
  isRefreshing: boolean
  error: Error | undefined
  refetch: typeof refetchReferencesMock
  mutate: ReturnType<typeof vi.fn>
}

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
  referencesQueryResult = {
    data: REFERENCES,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: refetchReferencesMock,
    mutate: vi.fn()
  }
  useQueryMock.mockImplementation((path: string) => {
    if (path === '/agent-workspaces/:workspaceId/references') return referencesQueryResult
    return {
      data: WORKSPACES,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: refetchWorkspacesMock,
      mutate: vi.fn()
    }
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
  createWorkspaceMock.mockResolvedValue(CREATED_WORKSPACE)
  deleteWorkspaceMock.mockResolvedValue({ deletedIds: ['session-alpha-recent', 'session-alpha-older'] })
  ipcRequestMock.mockImplementation((_route, input) =>
    deleteWorkspaceMock({ params: { workspaceId: input.workspaceId } })
  )
  invalidateCacheMock.mockResolvedValue(undefined)
  refetchReferencesMock.mockResolvedValue(undefined)
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

  it('creates and selects a workspace without an extra list refetch', async () => {
    selectFolderMock.mockResolvedValue('/Users/jd/new-project')
    const { onChange } = renderSelector()
    openPopover()

    await waitFor(() => expect(refetchWorkspacesMock).toHaveBeenCalledOnce())
    refetchWorkspacesMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Add new work directory' }))

    await waitFor(() =>
      expect(createWorkspaceMock).toHaveBeenCalledWith({
        body: { path: '/Users/jd/new-project' }
      })
    )
    expect(refetchWorkspacesMock).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith('workspace-created')
  })

  it('previews capped affected resource summaries before deleting a workspace', async () => {
    const user = userEvent.setup()
    renderSelector()
    openPopover()

    await user.click(screen.getAllByRole('button', { name: 'Delete work directory' })[0])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('cherry-studio')
    expect(dialog).toHaveTextContent('5 sessions')
    expect(dialog).toHaveTextContent('Fix workspace selector')
    expect(dialog).toHaveTextContent('Review delete dialog')
    expect(dialog).not.toHaveTextContent('Unrelated session')
    expect(dialog).toHaveTextContent('…and 3 more items')
    expect(dialog).toHaveTextContent('1 channels')
    expect(dialog).toHaveTextContent('Release bot')
    expect(dialog).toHaveTextContent('1 scheduled tasks')
    expect(dialog).toHaveTextContent('Nightly review')
    expect(dialog).toHaveTextContent('/Users/jd/cherry-studio')
    expect(screen.getByRole('list', { name: 'Sessions to be deleted' })).toHaveAttribute('tabindex', '0')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteWorkspaceMock).toHaveBeenCalledWith({ params: { workspaceId: 'workspace-alpha' } })
    )
    expect(closeConversationTabsMock).toHaveBeenCalledWith('agents', ['session-alpha-recent', 'session-alpha-older'])
    expect(invalidateCacheMock).toHaveBeenCalledWith([
      '/agent-sessions/session-alpha-recent',
      '/agent-sessions/session-alpha-older'
    ])
    expect(toastSuccessMock).toHaveBeenCalledWith('Deleted')
  })

  it('resets the parent when the deleted workspace is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <WorkspaceSelector trigger={<button type="button">Open</button>} value="workspace-alpha" onChange={onChange} />
    )
    openPopover()

    await user.click(screen.getAllByRole('button', { name: 'Delete work directory' })[0])
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
  })

  it('does not allow confirmation while a cached impact is refreshing', async () => {
    referencesQueryResult = { ...referencesQueryResult, isRefreshing: true }
    const user = userEvent.setup()
    renderSelector()
    openPopover()

    await user.click(screen.getAllByRole('button', { name: 'Delete work directory' })[0])

    expect(await screen.findByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByText('Loading deletion impact…')).toBeInTheDocument()
  })

  it('keeps the dialog open and reports a failed deletion', async () => {
    const user = userEvent.setup()
    deleteWorkspaceMock.mockRejectedValueOnce(new Error('delete failed'))
    renderSelector()
    openPopover()

    await user.click(screen.getAllByRole('button', { name: 'Delete work directory' })[0])
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
