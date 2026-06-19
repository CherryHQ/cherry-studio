import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { createWorkspaceMock, refetchWorkspacesMock, selectFolderMock, useMutationMock, useQueryMock } = vi.hoisted(
  () => ({
    createWorkspaceMock: vi.fn(),
    refetchWorkspacesMock: vi.fn(),
    selectFolderMock: vi.fn(),
    useMutationMock: vi.fn(),
    useQueryMock: vi.fn()
  })
)

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          'agent.session.workspace_selector.create_failed': 'Failed to add work directory',
          'agent.session.workspace_selector.create_new': 'Add new work directory',
          'agent.session.workspace_selector.empty_text': 'No work directories',
          'agent.session.workspace_selector.no_project': 'No work directory',
          'agent.session.workspace_selector.search_placeholder': 'Search work directories',
          'agent.session.workspace_selector.select_failed': 'Failed to select folder'
        })[key] ?? key
    })
  }
})

import { DEFAULT_SELECTOR_CONTENT_HEIGHT } from '@renderer/components/Selector/shell/SelectorShell'

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

const toastErrorMock = vi.fn()

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
  useMutationMock.mockReturnValue({
    trigger: createWorkspaceMock,
    isLoading: false,
    error: undefined
  })
  createWorkspaceMock.mockResolvedValue(CREATED_WORKSPACE)
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
  window.toast = { error: toastErrorMock } as unknown as typeof window.toast
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

  it('sets the default popover target height', () => {
    renderSelector()
    openPopover()

    expect(document.querySelector('[data-selector-shell-content]')).toHaveStyle({
      height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px`
    })
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
})
