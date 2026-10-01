import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { ExternalKnowledgeSourceListItem } from '@shared/data/api/schemas/externalKnowledge'
import type { ExternalKnowledgeConnectionListItem } from '@shared/data/api/schemas/externalKnowledgeConnections'

import ExternalSourcesSection from '../ExternalSourcesSection'

const mockQuery = vi.fn()
const mockDocuments = vi.fn()
const mockRequest = vi.fn()
const mockOpenExternal = vi.fn(async () => undefined)

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockQuery(...args),
  useInfiniteQuery: () => mockDocuments(),
  useDataChange: () => undefined
}))
vi.mock('@renderer/hooks/useJob', () => ({
  useJob: () => ({ data: { status: 'running' } }),
  useJobProgress: () => ({ progress: 50, detail: { stage: 'reading', currentFile: 1, totalFiles: 3 } })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => mockRequest(...args) } }))
vi.mock('@cherrystudio/ui', async () => ({
  ...(await import('@cherrystudio/ui/components/primitives/button')),
  ...(await import('@cherrystudio/ui/components/primitives/input')),
  ...(await import('@cherrystudio/ui/components/primitives/label')),
  ...(await import('@cherrystudio/ui/components/primitives/tooltip')),
  ...(await import('@cherrystudio/ui/components/primitives/segmented-control')),
  ...(await import('@cherrystudio/ui/components/primitives/dialog')),
  ...(await import('@cherrystudio/ui/components/composites/page-side-panel')),
  ...(await import('@cherrystudio/ui/components/composites/confirm-dialog'))
}))

const source = {
  id: 'source-1',
  baseId: 'base-1',
  connectionId: 'connection-1',
  name: 'Team handbook',
  state: 'active',
  scope: { kind: 'node', nodeId: 'wiki-node' },
  spaceId: 'space-1',
  activeJobId: 'job-1',
  schedule: { policy: { kind: 'manual' }, nextRunAt: null },
  lastFinishedAt: '2026-09-20T09:00:00.000Z',
  lastSuccessfulSyncAt: '2026-09-20T09:00:00.000Z',
  lastIndexedCount: 2,
  lastUnchangedCount: 1,
  lastSkippedCount: 0,
  lastWarningCount: 0
} as ExternalKnowledgeSourceListItem

const connection = {
  id: 'connection-1',
  displayName: 'Alice',
  authorizationStatus: 'connected',
  sourceCount: 1
} as ExternalKnowledgeConnectionListItem

describe('ExternalSourcesSection', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })
  beforeEach(() => {
    mockRequest.mockReset()
    mockQuery.mockReset()
    mockDocuments.mockReset()
    mockDocuments.mockReturnValue({ pages: [{ items: [] }], isLoading: false, hasNext: false, refresh: vi.fn() })
    mockOpenExternal.mockClear()
    Object.assign(window.api, { shell: { openExternal: mockOpenExternal } })
    mockQuery.mockImplementation((path: string) => {
      if (path === '/external-knowledge-connections') return { data: [connection], refetch: vi.fn() }
      if (path === '/external-knowledge-sources/:id/documents') return { data: { items: [] }, refetch: vi.fn() }
      return { data: [source], isLoading: false, refetch: vi.fn() }
    })
    mockRequest.mockResolvedValue(undefined)
  })

  it('shows the account, scope, live job stage, sync summary, and times', () => {
    render(<ExternalSourcesSection baseId="base-1" />)
    expect(screen.getByRole('region', { name: 'External sources' })).toHaveTextContent('Alice · Node · space-1')
    expect(screen.getByRole('status')).toHaveTextContent('Syncing · Stage: Reading')
    expect(screen.getByText(/Last sync: 2 indexed, 1 unchanged/)).toBeInTheDocument()
    expect(screen.getByText(/Last successful sync/)).toBeInTheDocument()
    expect(screen.getByText(/Next scheduled run: Never/)).toBeInTheDocument()
  })

  it('only saves display name and manual or daily schedule settings', async () => {
    const user = userEvent.setup()
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Team handbook' }))
    const details = screen.getByRole('dialog', { name: 'Team handbook' })
    await waitFor(() => expect(details).toHaveFocus())
    await user.clear(within(details).getByLabelText('Source name'))
    await user.type(within(details).getByLabelText('Source name'), 'New title')
    expect(within(details).getByRole('radio', { name: 'Manual' })).toBeChecked()
    await user.click(within(details).getByRole('radio', { name: 'Daily' }))
    expect(within(details).getByRole('radio', { name: 'Daily' })).toBeChecked()
    fireEvent.change(within(details).getByLabelText('Daily sync time'), { target: { value: '10:30' } })
    await user.click(within(details).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.rename', {
        sourceId: 'source-1',
        name: 'New title'
      })
    )
    expect(toast.success).toHaveBeenCalledWith('Saved')
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.schedule.update', {
      sourceId: 'source-1',
      policy: expect.objectContaining({ kind: 'daily', time: '10:30' })
    })
  })

  it('requires an explicit keep or remove choice when disconnecting', async () => {
    const user = userEvent.setup()
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Feishu content will not be changed')
    expect(dialog).toHaveTextContent('Reconnecting later may create duplicate items')
    expect(within(dialog).getByRole('button', { name: 'Remove local content' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep local content' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.disconnect', {
        sourceId: 'source-1',
        mode: 'keep-local'
      })
    )
  })

  it('removes local snapshots only when that disconnect choice is selected', async () => {
    const user = userEvent.setup()
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove local content' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.disconnect', {
        sourceId: 'source-1',
        mode: 'remove-local'
      })
    )
  })

  it('shows unavailable tombstones only in source notices without a body', async () => {
    const user = userEvent.setup()
    mockDocuments.mockReturnValue({
      pages: [
        { items: [{ id: 'document-1', title: 'Older document', availability: 'unavailable', currentWarning: null }] }
      ],
      isLoading: false,
      hasNext: false,
      refresh: vi.fn()
    })
    render(<ExternalSourcesSection baseId="base-1" />)
    expect(screen.queryByText('Older document')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Team handbook' }))
    expect(
      within(screen.getByRole('dialog', { name: 'Team handbook' })).getByText('Older document')
    ).toBeInTheDocument()
    expect(screen.getByText('Unavailable in the latest sync. No local body is available.')).toBeInTheDocument()
  })

  it('shows connection usage, blocks removal, and supports reauthorization', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => {
      if (path === '/external-knowledge-connections')
        return { data: [{ ...connection, authorizationStatus: 'reauthorization-required' }], refetch: vi.fn() }
      if (path === '/external-knowledge-sources/:id/documents') return { data: { items: [] }, refetch: vi.fn() }
      return { data: [source], isLoading: false, refetch: vi.fn() }
    })
    mockRequest.mockImplementation(async (route: string) =>
      route === 'knowledge.feishu.connection.reconnect'
        ? {
            authorizationSessionId: 'session-1',
            verificationUri: 'https://feishu.example/verify',
            userCode: 'ABCD'
          }
        : undefined
    )
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Connections' }))
    const panel = screen.getByRole('dialog', { name: 'Connections' })
    expect(panel).toHaveTextContent('Used by 1 source(s)')
    expect(within(panel).getByRole('button', { name: 'Delete' })).toBeDisabled()
    await user.click(within(panel).getByRole('button', { name: 'Reconnect' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.complete', {
        authorizationSessionId: 'session-1'
      })
    )
    expect(mockOpenExternal).toHaveBeenCalledWith('https://feishu.example/verify')
  })

  it('blocks all settings writes when the daily time is empty', async () => {
    const user = userEvent.setup()
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Team handbook' }))
    const details = screen.getByRole('dialog', { name: 'Team handbook' })
    await waitFor(() => expect(details).toHaveFocus())
    expect(details).toHaveTextContent('Node · space-1 · wiki-node')
    await user.type(within(details).getByLabelText('Source name'), ' edited')
    await user.click(within(details).getByRole('radio', { name: 'Daily' }))
    await user.clear(within(details).getByLabelText('Daily sync time'))
    expect(within(details).getByLabelText('Daily sync time')).toBeInvalid()
    expect(within(details).getByText('Required field')).toBeInTheDocument()
    const save = within(details).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(mockRequest).not.toHaveBeenCalled()
    await user.click(within(details).getByRole('radio', { name: 'Manual' }))
    expect(within(details).queryByLabelText('Daily sync time')).not.toBeInTheDocument()
    expect(save).toBeEnabled()
  })

  it('keeps settings fixed while saving and confirms completion', async () => {
    const user = userEvent.setup()
    let finishSave!: () => void
    mockRequest.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve
      })
    )
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Team handbook' }))
    const details = screen.getByRole('dialog', { name: 'Team handbook' })
    await waitFor(() => expect(details).toHaveFocus())
    await user.clear(within(details).getByLabelText('Source name'))
    await user.type(within(details).getByLabelText('Source name'), 'Edited title')
    expect(within(details).getByLabelText('Source name')).toHaveValue('Edited title')
    await user.click(within(details).getByRole('button', { name: 'Save' }))
    expect(within(details).getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
    expect(within(details).getByLabelText('Source name')).toBeDisabled()
    expect(within(details).getByRole('radio', { name: 'Daily' })).toBeDisabled()
    expect(within(details).getByRole('button', { name: 'Disconnect' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(details).toBeInTheDocument()
    await act(async () => finishSave())
    expect(toast.success).toHaveBeenCalledWith('Saved')
    expect(within(details).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it.each([
    ['Keep local content', 'Remove local content'],
    ['Remove local content', 'Keep local content']
  ])('shows progress only for %s until disconnect finishes', async (choice, otherChoice) => {
    const user = userEvent.setup()
    let finishDisconnect!: () => void
    mockRequest.mockReturnValue(
      new Promise<void>((resolve) => {
        finishDisconnect = resolve
      })
    )
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect external source?' })
    const activeButton = within(dialog).getByRole('button', { name: choice })
    const otherButton = within(dialog).getByRole('button', { name: otherChoice })
    await user.click(activeButton)
    expect(activeButton).toHaveAttribute('aria-busy', 'true')
    expect(activeButton).toBeDisabled()
    expect(otherButton).not.toHaveAttribute('aria-busy', 'true')
    expect(otherButton).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    await act(async () => finishDisconnect())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('clears disconnect progress after failure and allows retrying the other choice', async () => {
    const user = userEvent.setup()
    let failDisconnect!: (reason: Error) => void
    mockRequest.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        failDisconnect = reject
      })
    )
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect external source?' })
    const keep = within(dialog).getByRole('button', { name: 'Keep local content' })
    const remove = within(dialog).getByRole('button', { name: 'Remove local content' })
    await user.click(keep)
    expect(keep).toHaveAttribute('aria-busy', 'true')
    await act(async () => failDisconnect(new Error('Service unavailable')))
    expect(dialog).toBeInTheDocument()
    expect(keep).not.toHaveAttribute('aria-busy', 'true')
    expect(keep).toBeEnabled()
    expect(remove).toBeEnabled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Could not disconnect this source.'))
    await user.click(remove)
    expect(mockRequest).toHaveBeenLastCalledWith('knowledge.external_source.disconnect', {
      sourceId: 'source-1',
      mode: 'remove-local'
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps pagination busy without claiming unseen document pages have no notices', async () => {
    const user = userEvent.setup()
    mockDocuments.mockReturnValue({
      pages: [{ items: [] }],
      isLoading: false,
      isRefreshing: true,
      hasNext: true,
      loadNext: vi.fn()
    })
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Team handbook' }))
    expect(screen.queryByText('No source notices.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more notices' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Load more notices' })).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps connection removal open after failure so the user can retry', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [{ ...connection, sourceCount: 0 }] : [source],
      refetch: vi.fn()
    }))
    mockRequest.mockRejectedValue(new Error('Connection is unavailable'))
    render(<ExternalSourcesSection baseId="base-1" />)
    await user.click(screen.getByRole('button', { name: 'Connections' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Connections' })).getByRole('button', { name: 'Delete' })
    )
    const dialog = screen.getByRole('dialog', { name: 'Remove connection?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
})
