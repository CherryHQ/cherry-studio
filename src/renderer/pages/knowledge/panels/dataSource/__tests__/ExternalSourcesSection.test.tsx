import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
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
vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    ...props
  }: {
    children: ReactNode
    variant?: string
    size?: string
    [key: string]: unknown
  }) => {
    delete props.variant
    delete props.size
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  PageSidePanel: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? (
      <aside role="dialog" aria-label={title}>
        {children}
      </aside>
    ) : null,
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ConfirmDialog: ({
    open,
    title,
    confirmText,
    onConfirm
  }: {
    open: boolean
    title: string
    confirmText: string
    onConfirm: () => void
  }) =>
    open ? (
      <div role="dialog">
        <h2>{title}</h2>
        <button type="button" onClick={onConfirm}>
          {confirmText}
        </button>
      </div>
    ) : null
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
    await user.clear(within(details).getByLabelText('Source name'))
    await user.type(within(details).getByLabelText('Source name'), 'New title')
    await user.click(within(details).getByRole('button', { name: 'Daily' }))
    fireEvent.change(within(details).getByLabelText('Daily sync time'), { target: { value: '10:30' } })
    await user.click(within(details).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.rename', {
        sourceId: 'source-1',
        name: 'New title'
      })
    )
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
})
