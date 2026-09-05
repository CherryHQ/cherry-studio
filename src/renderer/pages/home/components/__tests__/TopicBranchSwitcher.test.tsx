import type * as CherryUi from '@cherrystudio/ui'
import type { TreeResponse } from '@shared/data/types/message'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicBranchSwitcher from '../TopicBranchSwitcher'

const mocks = vi.hoisted(() => ({
  copyBranch: vi.fn().mockResolvedValue({ id: 'copied-topic' }),
  exportBranch: vi.fn().mockResolvedValue(undefined),
  refetch: vi.fn().mockResolvedValue(undefined),
  setActiveNode: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  tree: null as TreeResponse | null,
  useDataChange: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@cherrystudio/ui', async () => vi.importActual<typeof CherryUi>('@cherrystudio/ui'))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [{ markdown: true, markdownReason: true }, vi.fn()]
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useDataChange: mocks.useDataChange,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/services/ExportService', () => ({
  exportTopicBranchAsMarkdown: mocks.exportBranch
}))

vi.mock('@renderer/services/imageExportModeChooser', () => ({
  chooseImageExportMode: vi.fn()
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, options?: Record<string, unknown>) => {
      const strings: Record<string, string> = {
        'chat.branch_switcher.actions': `Actions for ${options?.name}`,
        'chat.branch_switcher.branched_after_turn': `Branched after turn ${options?.turn}`,
        'chat.branch_switcher.branched_at_start': 'Branched at start',
        'chat.branch_switcher.branches': 'Branches',
        'chat.branch_switcher.copy_failed': 'Failed to copy branch',
        'chat.branch_switcher.current_path': 'Current path',
        'chat.branch_switcher.fallback': `Branch ${options?.number}`,
        'chat.branch_switcher.last_active': `Last active: ${options?.time}`,
        'chat.branch_switcher.load_failed': 'Failed to load branches',
        'chat.branch_switcher.main': 'Main',
        'chat.branch_switcher.new_branch': 'New branch',
        'chat.branch_switcher.switch_failed': 'Failed to switch branch',
        'chat.branch_switcher.trigger': `${options?.name}, ${options?.count} branches`,
        'chat.branch_switcher.turn_count': `${options?.count} turns`,
        'chat.message.flow.copy_topic.created': 'Copied to a new conversation',
        'chat.message.flow.copy_topic.label': 'Copy as New Conversation',
        'chat.topics.export.md.label': 'Export as Markdown',
        'chat.topics.export.md.reason': 'Export as Markdown (with reasoning)',
        'common.loading': 'Loading'
      }
      return strings[key] ?? key
    }
  })
}))

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Conversation title',
  lastActivityAt: '2026-01-01T00:05:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:05:00.000Z',
  messages: []
}

const anchor = <span>Conversation title</span>

const branchedTree: TreeResponse = {
  activeNodeId: 'answer-branch',
  rootId: 'virtual-root',
  nodes: [
    {
      id: 'user-1',
      parentId: 'virtual-root',
      role: 'user',
      hasContent: true,
      preview: 'Question',
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z',
      hasChildren: true
    },
    {
      id: 'answer-1',
      parentId: 'user-1',
      role: 'assistant',
      hasContent: true,
      preview: 'Answer',
      status: 'success',
      createdAt: '2026-01-01T00:01:00.000Z',
      hasChildren: true
    },
    {
      id: 'user-main',
      parentId: 'answer-1',
      role: 'user',
      hasContent: true,
      preview: 'Original route',
      status: 'success',
      createdAt: '2026-01-01T00:02:00.000Z',
      hasChildren: false
    },
    {
      id: 'user-branch',
      parentId: 'answer-1',
      role: 'user',
      hasContent: true,
      preview: 'Try another model',
      status: 'success',
      createdAt: '2026-01-01T00:03:00.000Z',
      hasChildren: true
    },
    {
      id: 'answer-branch',
      parentId: 'user-branch',
      role: 'assistant',
      hasContent: true,
      preview: 'Alternative answer',
      status: 'success',
      createdAt: '2026-01-01T00:04:00.000Z',
      hasChildren: false
    }
  ],
  siblingsGroups: []
}

describe('TopicBranchSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tree = branchedTree
    mocks.useQuery.mockImplementation(() => ({
      data: mocks.tree,
      error: undefined,
      isLoading: false,
      refetch: mocks.refetch
    }))
    mocks.useMutation.mockImplementation((_method: string, path: string) => ({
      trigger: path === '/topics/:id/duplicate' ? mocks.copyBranch : mocks.setActiveNode
    }))
  })

  it('hides the trigger for a single endpoint and shows the active branch for multiple endpoints', () => {
    mocks.tree = {
      ...branchedTree,
      activeNodeId: 'answer-1',
      nodes: [branchedTree.nodes[0], branchedTree.nodes[1], branchedTree.nodes[2]]
    }
    const { rerender } = render(<TopicBranchSwitcher topic={topic} anchor={anchor} />)

    expect(screen.queryByRole('button', { name: /branches$/ })).not.toBeInTheDocument()

    mocks.tree = branchedTree
    rerender(<TopicBranchSwitcher topic={topic} anchor={anchor} />)

    const trigger = screen.getByRole('button', { name: 'Try another model, 2 branches' })
    expect(trigger).toHaveTextContent(/^Try another model$/)
  })

  it('switches once, closes on success, and skips requests for the current branch', async () => {
    let resolveSwitch!: () => void
    mocks.setActiveNode.mockReturnValueOnce(new Promise<void>((resolve) => (resolveSwitch = resolve)))
    mocks.tree = {
      ...branchedTree,
      nodes: [
        ...branchedTree.nodes,
        {
          ...branchedTree.nodes[2],
          id: 'user-third',
          preview: 'Third route',
          createdAt: '2026-01-01T00:05:00.000Z'
        }
      ]
    }
    const user = userEvent.setup()
    render(<TopicBranchSwitcher topic={topic} anchor={anchor} />)

    const trigger = screen.getByRole('button', { name: 'Try another model, 3 branches' })
    await user.click(trigger)
    const mainBranch = screen.getByRole('button', { name: /^Main / })
    const thirdBranch = screen.getByRole('button', { name: /^Third route / })

    act(() => {
      mainBranch.click()
      thirdBranch.click()
    })

    expect(mocks.setActiveNode).toHaveBeenCalledOnce()
    expect(mocks.setActiveNode).toHaveBeenCalledWith({
      params: { id: 'topic-1' },
      body: { nodeId: 'user-main' }
    })
    expect(thirdBranch).toBeDisabled()

    resolveSwitch()
    await waitFor(() => expect(screen.queryByLabelText('Branches')).not.toBeInTheDocument())

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: /^Try another model / }))

    expect(mocks.setActiveNode).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Branches')).not.toBeInTheDocument()
  })

  it('keeps the list open, reports failure, and refetches a stale tree when switching fails', async () => {
    const user = userEvent.setup()
    mocks.setActiveNode.mockRejectedValueOnce(new Error('stale leaf'))
    render(<TopicBranchSwitcher topic={topic} anchor={anchor} />)

    await user.click(screen.getByRole('button', { name: 'Try another model, 2 branches' }))
    await user.click(screen.getByRole('button', { name: /^Main / }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to switch branch')
      expect(mocks.refetch).toHaveBeenCalledOnce()
    })
    expect(screen.getByLabelText('Branches')).toBeInTheDocument()
  })

  it('refreshes the tree after a matching data change', () => {
    render(<TopicBranchSwitcher topic={topic} anchor={anchor} />)

    expect(mocks.useDataChange).toHaveBeenCalledWith('/topics/:topicId/tree', expect.any(Function), {
      routeParams: { topicId: 'topic-1' }
    })
    const listener = mocks.useDataChange.mock.calls.at(-1)?.[1] as (() => void) | undefined
    listener?.()

    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('runs the same branch actions from the ellipsis and context menus', async () => {
    let resolveCopy!: () => void
    const user = userEvent.setup()
    render(<TopicBranchSwitcher topic={topic} anchor={anchor} />)

    await user.click(screen.getByRole('button', { name: 'Try another model, 2 branches' }))
    await user.click(screen.getByRole('button', { name: 'Actions for Try another model' }))
    expect(screen.getByLabelText('Branches')).toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Export as Markdown' }))

    await waitFor(() => {
      expect(mocks.exportBranch).toHaveBeenCalledWith(
        topic,
        { nodeId: 'answer-branch', name: 'Try another model' },
        false,
        expect.any(Function)
      )
    })

    mocks.copyBranch.mockReturnValueOnce(new Promise<void>((resolve) => (resolveCopy = resolve)))
    await user.click(screen.getByRole('button', { name: 'Try another model, 2 branches' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Main / }))
    const copyAction = await screen.findByRole('menuitem', { name: 'Copy as New Conversation' })

    act(() => {
      copyAction.click()
      copyAction.click()
    })

    expect(mocks.copyBranch).toHaveBeenCalledOnce()
    expect(mocks.copyBranch).toHaveBeenCalledWith({
      params: { id: 'topic-1' },
      body: { nodeId: 'user-main' }
    })

    resolveCopy()
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Copied to a new conversation'))
  })

  it('opens, traverses, and selects from the keyboard, then returns focus on Escape', async () => {
    const user = userEvent.setup()
    render(<TopicBranchSwitcher topic={topic} anchor={anchor} />)
    const trigger = screen.getByRole('button', { name: 'Try another model, 2 branches' })

    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Branches')).toBeInTheDocument()
    const mainBranch = screen.getByRole('button', { name: /^Main / })
    const activeBranch = screen.getByRole('button', { name: /^Try another model / })
    await waitFor(() => expect(activeBranch).toHaveFocus())
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(mainBranch).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mocks.setActiveNode).toHaveBeenCalledWith({
      params: { id: 'topic-1' },
      body: { nodeId: 'user-main' }
    })

    trigger.focus()
    await user.keyboard('{Enter}')
    const reopenedActiveBranch = screen.getByRole('button', { name: /^Try another model / })
    await waitFor(() => expect(reopenedActiveBranch).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(screen.queryByLabelText('Branches')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
