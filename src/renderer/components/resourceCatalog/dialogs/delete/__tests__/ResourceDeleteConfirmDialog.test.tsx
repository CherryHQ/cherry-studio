import type * as CherryStudioUi from '@cherrystudio/ui'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceDeleteConfirmDialog } from '../ResourceDeleteConfirmDialog'

const mocks = vi.hoisted(() => ({
  deleteAssistant: vi.fn(),
  getActiveResource: vi.fn(),
  deletePrompt: vi.fn(),
  closeConversationTabs: vi.fn(),
  invalidate: vi.fn(),
  ipcRequest: vi.fn(),
  restoreAgent: vi.fn(),
  restoreAssistant: vi.fn(),
  restoreSession: vi.fn(),
  showRecycleBinBatchUndo: vi.fn(),
  showRecycleBinUndo: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  uninstallSkill: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.cancel': 'Cancel',
          'common.delete': 'Delete',
          'library.action.uninstall': 'Uninstall',
          'library.delete.skill.content': 'Uninstall skill content',
          'library.delete.skill.title': 'Uninstall skill',
          'agent.session.agent.delete.content': 'Delete all sessions without deleting the Agent.',
          'agent.session.agent.delete.title': 'Delete all sessions',
          'agent.session.agent.delete.trigger': 'Delete all sessions',
          'recycle_bin.already_moved': 'Already in Recycle Bin',
          'recycle_bin.move.confirm_action': 'Move to Recycle Bin',
          'recycle_bin.move.confirm_title': 'Move to Recycle Bin?',
          'recycle_bin.move.related_sessions': 'Also move related sessions to the Recycle Bin',
          'recycle_bin.move.related_topics': 'Also move related topics to the Recycle Bin',
          'settings.prompts.delete': 'Delete prompt',
          'settings.prompts.deleteConfirm': 'Delete prompt content'
        }) satisfies Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAssistantMutationsById: () => ({ deleteAssistant: mocks.deleteAssistant }),
  usePromptMutationsById: () => ({ deletePrompt: mocks.deletePrompt }),
  useSkillMutationsById: () => ({ uninstallSkill: mocks.uninstallSkill })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mocks.invalidate,
  useMutation: (method: string, path: string) => ({
    trigger:
      method === 'POST' && path === '/agents/:agentId/restore'
        ? mocks.restoreAgent
        : method === 'POST' && path === '/agent-sessions/:sessionId/restore'
          ? mocks.restoreSession
          : mocks.restoreAssistant
  })
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: mocks.getActiveResource }
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => mocks.closeConversationTabs
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@renderer/services/recycleBinFeedback', () => ({
  showRecycleBinBatchUndo: mocks.showRecycleBinBatchUndo,
  showRecycleBinUndo: mocks.showRecycleBinUndo
}))
vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo
  }
}))

function createResource(type: ResourceItem['type']): ResourceItem {
  return {
    id: `${type}-1`,
    type,
    name: `${type} name`,
    description: '',
    avatar: type[0],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    raw: {} as ResourceItem['raw']
  } as ResourceItem
}

function createProtectedAgentResource(): Extract<ResourceItem, { type: 'agent' }> {
  const resource = createResource('agent') as Extract<ResourceItem, { type: 'agent' }>
  return {
    ...resource,
    raw: {
      ...resource.raw,
      configuration: { ...resource.raw.configuration, builtin_role: 'assistant' }
    }
  }
}

describe('ResourceDeleteConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteAssistant.mockResolvedValue({ deleted: true, deletedTopicIds: ['topic-1'] })
    mocks.getActiveResource.mockResolvedValue({ id: 'active-resource' })
    mocks.deletePrompt.mockResolvedValue(undefined)
    mocks.invalidate.mockResolvedValue(undefined)
    mocks.ipcRequest.mockResolvedValue({ deleted: true, deletedSessionIds: ['session-1'] })
    mocks.restoreAgent.mockResolvedValue(undefined)
    mocks.restoreAssistant.mockResolvedValue(undefined)
    mocks.restoreSession.mockResolvedValue(undefined)
    mocks.uninstallSkill.mockResolvedValue(undefined)
  })

  it('renders nothing without a selected resource', () => {
    const { container } = render(<ResourceDeleteConfirmDialog resource={null} onClose={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('moves an Agent without its Sessions by default and offers a refreshing Undo', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocks.ipcRequest.mockResolvedValueOnce({ deleted: true, deletedSessionIds: [] })

    render(<ResourceDeleteConfirmDialog resource={createResource('agent')} onClose={onClose} />)

    expect(screen.getByRole('dialog')).toHaveTextContent('Move to Recycle Bin?')
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/tasks|subscriptions/i)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.delete', {
        agentId: 'agent-1',
        deleteSessions: false
      })
    )
    expect(mocks.closeConversationTabs).not.toHaveBeenCalled()
    expect(mocks.showRecycleBinUndo).toHaveBeenCalledWith({
      itemName: 'agent name',
      onUndo: expect.any(Function)
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await mocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()

    expect(mocks.restoreAgent).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
    expect(mocks.invalidate).toHaveBeenCalledWith('/agents')
    expect(mocks.invalidate).toHaveBeenCalledWith('/agent-sessions')
  })

  it('moves only the returned Agent Sessions when cascade is selected', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockResolvedValueOnce({ deleted: true, deletedSessionIds: ['session-2'] })

    render(<ResourceDeleteConfirmDialog resource={createResource('agent')} onClose={vi.fn()} />)

    await user.click(screen.getByLabelText('Also move related sessions to the Recycle Bin'))
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.delete', {
        agentId: 'agent-1',
        deleteSessions: true
      })
    )
    expect(mocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-2'])
  })

  it('treats an Agent restore NOT_FOUND as complete only when refresh confirms it is active', async () => {
    const user = userEvent.setup()
    mocks.restoreAgent.mockRejectedValueOnce(DataApiErrorFactory.notFound('Agent', 'agent-1'))

    render(<ResourceDeleteConfirmDialog resource={createResource('agent')} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
    await waitFor(() => expect(mocks.showRecycleBinUndo).toHaveBeenCalled())
    mocks.invalidate.mockClear()

    await expect(mocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()

    expect(mocks.invalidate).toHaveBeenCalledWith('/agents')
    expect(mocks.getActiveResource).toHaveBeenCalledWith('/agents/agent-1')
  })

  it('moves only protected Agent Sessions and restores the exact deleted Session IDs', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockResolvedValueOnce({ deletedIds: ['session-1', 'session-2'] })

    render(<ResourceDeleteConfirmDialog resource={createProtectedAgentResource()} onClose={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete all sessions without deleting the Agent.')
    await user.click(screen.getByRole('button', { name: 'Delete all sessions' }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.sessions.delete', { agentId: 'agent-1' })
    )
    expect(mocks.closeConversationTabs).toHaveBeenCalledWith('agents', ['session-1', 'session-2'])
    expect(mocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(mocks.showRecycleBinBatchUndo).toHaveBeenCalledWith({
      itemCount: 2,
      onUndo: expect.any(Function)
    })

    await expect(mocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toEqual({
      restored: ['session-1', 'session-2'],
      failed: []
    })

    expect(mocks.restoreSession).toHaveBeenCalledWith({ params: { sessionId: 'session-1' } })
    expect(mocks.restoreSession).toHaveBeenCalledWith({ params: { sessionId: 'session-2' } })
    expect(mocks.restoreAgent).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledWith('/agent-sessions')
  })

  it('refreshes an empty protected Agent Session delete without offering Undo', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockResolvedValueOnce({ deletedIds: [] })

    render(<ResourceDeleteConfirmDialog resource={createProtectedAgentResource()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Delete all sessions' }))

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith('Already in Recycle Bin'))
    expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.sessions.delete', { agentId: 'agent-1' })
    expect(mocks.closeConversationTabs).not.toHaveBeenCalled()
    expect(mocks.showRecycleBinBatchUndo).not.toHaveBeenCalled()
    expect(mocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(mocks.restoreAgent).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledWith('/agent-sessions')
  })

  it('moves an Assistant without its Topics by default and offers a refreshing Undo', async () => {
    const user = userEvent.setup()
    mocks.deleteAssistant.mockResolvedValueOnce({ deleted: true, deletedTopicIds: [] })

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() => expect(mocks.deleteAssistant).toHaveBeenCalledWith({ deleteTopics: false }))
    expect(mocks.closeConversationTabs).not.toHaveBeenCalled()
    expect(mocks.showRecycleBinUndo).toHaveBeenCalledWith({
      itemName: 'assistant name',
      onUndo: expect.any(Function)
    })

    await mocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()

    expect(mocks.restoreAssistant).toHaveBeenCalledWith({ params: { id: 'assistant-1' } })
    expect(mocks.invalidate).toHaveBeenCalledWith('/assistants')
    expect(mocks.invalidate).toHaveBeenCalledWith('/topics')
  })

  it('moves only the returned Assistant Topics when cascade is selected', async () => {
    const user = userEvent.setup()

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={vi.fn()} />)

    await user.click(screen.getByLabelText('Also move related topics to the Recycle Bin'))
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() => expect(mocks.deleteAssistant).toHaveBeenCalledWith({ deleteTopics: true }))
    expect(mocks.closeConversationTabs).toHaveBeenCalledWith('assistants', ['topic-1'])
  })

  it('keeps the owner dialog open after a failed delete and allows retry', async () => {
    const user = userEvent.setup()
    mocks.deleteAssistant.mockRejectedValueOnce(new Error('delete failed')).mockResolvedValueOnce({
      deleted: true,
      deletedTopicIds: []
    })
    const onClose = vi.fn()

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('treats an Assistant restore NOT_FOUND as complete only when refresh confirms it is active', async () => {
    const user = userEvent.setup()
    mocks.restoreAssistant.mockRejectedValueOnce(DataApiErrorFactory.notFound('Assistant', 'assistant-1'))

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
    await waitFor(() => expect(mocks.showRecycleBinUndo).toHaveBeenCalled())
    mocks.invalidate.mockClear()

    await expect(mocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()

    expect(mocks.invalidate).toHaveBeenCalledWith('/assistants')
    expect(mocks.getActiveResource).toHaveBeenCalledWith('/assistants/assistant-1')
  })

  it('keeps an Assistant restore NOT_FOUND failed when refresh cannot find an active row', async () => {
    const user = userEvent.setup()
    const restoreError = DataApiErrorFactory.notFound('Assistant', 'assistant-1')
    mocks.restoreAssistant.mockRejectedValueOnce(restoreError)
    mocks.getActiveResource.mockRejectedValueOnce(DataApiErrorFactory.notFound('Assistant', 'assistant-1'))

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
    await waitFor(() => expect(mocks.showRecycleBinUndo).toHaveBeenCalled())

    await expect(mocks.showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).rejects.toBe(restoreError)
  })

  it('counts active protected Sessions as restored after restore NOT_FOUND and keeps missing Sessions failed', async () => {
    const user = userEvent.setup()
    const firstError = DataApiErrorFactory.notFound('Session', 'session-active')
    const secondError = DataApiErrorFactory.notFound('Session', 'session-purged')
    mocks.ipcRequest.mockResolvedValueOnce({ deletedIds: ['session-active', 'session-purged'] })
    mocks.restoreSession.mockRejectedValueOnce(firstError).mockRejectedValueOnce(secondError)
    mocks.getActiveResource.mockImplementation((path: string) =>
      path === '/agent-sessions/session-active'
        ? Promise.resolve({ id: 'session-active' })
        : Promise.reject(DataApiErrorFactory.notFound('Session', 'session-purged'))
    )

    render(<ResourceDeleteConfirmDialog resource={createProtectedAgentResource()} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Delete all sessions' }))
    await waitFor(() => expect(mocks.showRecycleBinBatchUndo).toHaveBeenCalled())

    await expect(mocks.showRecycleBinBatchUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toEqual({
      restored: ['session-active'],
      failed: [{ id: 'session-purged', error: secondError.message }]
    })
    expect(mocks.getActiveResource).toHaveBeenCalledWith('/agent-sessions/session-active')
    expect(mocks.getActiveResource).toHaveBeenCalledWith('/agent-sessions/session-purged')
  })

  it('refreshes a stale Agent result without offering Undo', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockResolvedValueOnce({ deleted: false, deletedSessionIds: [] })

    render(<ResourceDeleteConfirmDialog resource={createResource('agent')} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith('Already in Recycle Bin'))
    expect(mocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledWith('/agents')
    expect(mocks.invalidate).toHaveBeenCalledWith('/agent-sessions')
  })

  it('refreshes a stale Assistant error without offering Undo', async () => {
    const user = userEvent.setup()
    mocks.deleteAssistant.mockRejectedValueOnce(DataApiErrorFactory.notFound('Assistant', 'assistant-1'))

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith('Already in Recycle Bin'))
    expect(mocks.showRecycleBinUndo).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledWith('/assistants')
    expect(mocks.invalidate).toHaveBeenCalledWith('/topics')
  })

  it.each([
    ['skill', 'Uninstall skill', 'Uninstall', mocks.uninstallSkill],
    ['prompt', 'Delete prompt', 'Delete', mocks.deletePrompt]
  ] as const)('preserves the existing %s removal contract', async (type, title, confirmText, mutation) => {
    const user = userEvent.setup()

    render(<ResourceDeleteConfirmDialog resource={createResource(type)} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog')).toHaveTextContent(title)
    await user.click(screen.getByRole('button', { name: confirmText }))

    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    expect(mocks.showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it('closes when the confirm dialog is dismissed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<ResourceDeleteConfirmDialog resource={createResource('assistant')} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
