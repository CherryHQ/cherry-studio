import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
  ...(await import('@cherrystudio/ui/components/primitives/accordion')),
  ...(await import('@cherrystudio/ui/components/primitives/alert')),
  ...(await import('@cherrystudio/ui/components/primitives/badge')),
  ...(await import('@cherrystudio/ui/components/primitives/combobox')),
  ...(await import('@cherrystudio/ui/components/primitives/input')),
  ...(await import('@cherrystudio/ui/components/primitives/field')),
  ...(await import('@cherrystudio/ui/components/primitives/label')),
  ...(await import('@cherrystudio/ui/components/primitives/tooltip')),
  ...(await import('@cherrystudio/ui/components/composites/icon-tooltips')),
  ...(await import('@cherrystudio/ui/components/primitives/switch')),
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

const connection: ExternalKnowledgeConnectionListItem = {
  id: 'connection-1',
  displayName: 'Alice',
  applicationName: 'Team Wiki',
  appId: 'cli_original',
  appCredentialSource: 'custom-app',
  authorizationStatus: 'connected',
  provider: 'feishu',
  accountUserId: 'alice',
  accountOpenId: 'open-alice',
  accountUnionId: null,
  tenantKey: 'acme',
  avatarUrl: null,
  sourceCount: 1,
  grantedScopes: [
    'wiki:node:read',
    'wiki:node:retrieve',
    'docs:document.content:read',
    'offline_access',
    'contact:user.employee_id:readonly'
  ],
  authorizedAt: '2026-07-01T00:00:00.000Z',
  lastValidatedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z'
}

const SourcesHarness = () => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Sync sources
      </button>
      <ExternalSourcesSection
        baseId="base-1"
        open={open}
        onOpenChange={setOpen}
        onAddSource={() => undefined}
        canAddSource
      />
    </>
  )
}

const openSourceSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Sync sources' }))
  const manager = screen.getByRole('dialog', { name: 'Sync sources' })
  await waitFor(() => expect(manager).toHaveFocus())
  await user.click(within(manager).getByRole('button', { name: 'View details' }))
}

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

  it('keeps an empty source list out of the main view while allowing management', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    expect(screen.queryByRole('region', { name: 'Sync sources' })).not.toBeInTheDocument()
    expect(screen.queryByText('No sync sources yet.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    expect(screen.getByRole('dialog', { name: 'Sync sources' })).toHaveTextContent('No sync sources yet.')
    expect(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') })).toBeEnabled()
  })

  it('shows neither names nor an aggregate summary for idle sources', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [connection]
          : [
              { ...source, activeJobId: null },
              { ...source, id: 'source-2', name: 'API reference', activeJobId: null }
            ],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    expect(screen.queryByText('Team handbook')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sync sources' })).not.toBeInTheDocument()
    expect(screen.queryByText('API reference')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    expect(screen.getByRole('dialog', { name: 'Sync sources' })).toHaveTextContent('API reference')
  })

  it('opens actionable source failures from the inline attention status', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [connection]
          : [{ ...source, activeJobId: null, lastOutcome: 'failed', lastErrorSummary: 'timeout' }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    expect(screen.getByRole('alert')).toHaveTextContent('1 source(s) need attention')
    await user.click(screen.getByRole('button', { name: '1 source(s) need attention' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    expect(within(manager).getByText('Sync failed')).toBeVisible()
    expect(within(manager).queryByText('Sync timed out. Try again.')).not.toBeInTheDocument()
    expect(within(manager).queryByRole('button', { name: 'Retry sync' })).not.toBeInTheDocument()
    await user.click(within(manager).getByRole('button', { name: 'View details' }))
    const details = screen.getByRole('dialog', { name: 'Source details' })
    expect(details).toHaveTextContent('Sync timed out. Try again.')
    expect(within(details).getByRole('button', { name: 'Manual sync' })).toBeEnabled()
  })

  it('separates paused source status from history and reveals remote identifiers only in details', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [{ ...connection, authorizationStatus: 'reauthorization-required' }]
          : [{ ...source, state: 'paused', activeJobId: null, lastOutcome: 'completed' }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    expect(within(manager).getByText('Paused')).toBeVisible()
    expect(within(manager).queryByText('Sync is paused. Check the account connection.')).not.toBeInTheDocument()
    expect(within(manager).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
    expect(within(manager).queryByText('Sync completed', { exact: false })).not.toBeInTheDocument()
    expect(within(manager).queryByText('space-1', { exact: false })).not.toBeInTheDocument()
    expect(within(manager).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()

    await user.click(within(manager).getByRole('button', { name: 'View details' }))
    const details = screen.getByRole('dialog', { name: 'Source details' })
    const result = within(details).getByRole('region', { name: 'Last sync result' })
    expect(result).toHaveTextContent('Sync completed')
    expect(within(result).getByText('Documents added or updated in this sync: 2')).toBeVisible()
    expect(within(details).queryByText('Sync is paused. Check the account connection.')).not.toBeInTheDocument()
    expect(within(details).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Manual sync' })).toBeEnabled()
    expect(within(details).queryByText('space-1')).not.toBeInTheDocument()
    expect(within(details).queryByText('wiki-node')).not.toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Source information' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await user.click(within(details).getByRole('button', { name: 'Source information' }))
    expect(within(details).getByText('space-1')).toBeVisible()
    expect(within(details).getByText('wiki-node')).toBeVisible()
    await user.click(within(details).getByRole('button', { name: 'Source information' }))
    expect(within(details).queryByText('space-1')).not.toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Disconnect' })).toBeEnabled()
  })

  it('returns from source settings and account connections without stacking panels', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    await openSourceSettings(user)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Sync sources' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    expect(screen.getByRole('dialog', { name: i18n.t('knowledge.external.sources.connections') })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Sync sources' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps a previous failure reason in history while reconnecting takes priority', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [{ ...connection, authorizationStatus: 'reauthorization-required' }]
          : [{ ...source, state: 'paused', activeJobId: null, lastOutcome: 'failed', lastErrorSummary: 'timeout' }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    expect(within(manager).queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
    expect(within(manager).queryByRole('button', { name: 'Retry sync' })).not.toBeInTheDocument()
    expect(within(manager).queryByText('Sync timed out. Try again.')).not.toBeInTheDocument()
    await user.click(within(manager).getByRole('button', { name: 'View details' }))
    const result = within(screen.getByRole('dialog', { name: 'Source details' })).getByRole('region', {
      name: 'Last sync result'
    })
    expect(within(result).getByRole('alert')).toHaveTextContent('Sync timed out. Try again.')
  })

  it('opens the chosen source and restores its detail entry in a multi-source list', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [connection]
          : [source, { ...source, id: 'source-2', name: 'API reference' }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const entry = within(screen.getByRole('group', { name: 'API reference' })).getByRole('button', {
      name: 'View details'
    })
    await user.click(entry)
    expect(within(screen.getByRole('dialog', { name: 'Source details' })).getByText('API reference')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      within(screen.getByRole('group', { name: 'API reference' })).getByRole('button', { name: 'View details' })
    ).toHaveFocus()
  })

  it('keeps keyboard focus in source settings and restores the source entry when going back', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    await waitFor(() => expect(manager).toHaveFocus())

    await user.click(within(manager).getByRole('button', { name: 'View details' }))
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'View details' })).toHaveFocus()
  })

  it('restores the account entry after returning from account connections with the keyboard', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sync sources' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') })).toHaveFocus()
  })

  it('restores the header entry focus after closing the manager', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    const entry = screen.getByRole('button', { name: 'Sync sources' })
    await user.click(entry)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sync sources' })).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(entry).toHaveFocus()
  })

  it('shows a brief syncing status and puts detailed progress and account information in management', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    expect(screen.getByRole('status')).toHaveTextContent('1 source(s) syncing')
    expect(screen.queryByText('Syncing · Stage: Reading')).not.toBeInTheDocument()
    expect(screen.queryByText(/Last sync: 2 indexed, 1 unchanged/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    expect(manager).toHaveTextContent('Alice · Node')
    expect(within(manager).queryByText('space-1', { exact: false })).not.toBeInTheDocument()
    expect(manager).toHaveTextContent('Syncing · Stage: Reading')
    expect(within(manager).queryByText(/Last sync: 2 indexed, 1 unchanged/)).not.toBeInTheDocument()
    expect(within(manager).getByText(/Last successful sync/)).toBeInTheDocument()
    expect(within(manager).queryByText(/Next scheduled run/)).not.toBeInTheDocument()
    expect(within(manager).queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
    await user.click(within(manager).getByRole('button', { name: 'View details' }))
    const details = screen.getByRole('dialog', { name: 'Source details' })
    const result = within(details).getByRole('region', { name: 'Last sync result' })
    expect(within(result).getByText('Documents added or updated in this sync: 2')).toBeVisible()
    expect(within(result).queryByText('Indexed')).not.toBeInTheDocument()
    expect(within(result).queryByText('Unchanged')).not.toBeInTheDocument()
    expect(within(result).queryByText('Skipped')).not.toBeInTheDocument()
    expect(within(result).queryByText('Notices')).not.toBeInTheDocument()
    const syncDetails = within(result).getByRole('button', { name: 'Sync details' })
    expect(syncDetails).toHaveAttribute('aria-expanded', 'false')
    await user.click(syncDetails)
    expect(within(result).getByText('Unchanged')).toBeVisible()
    expect(within(result).getByText('Skipped')).toBeVisible()
    expect(within(result).getByText('1')).toBeVisible()
    expect(within(result).getByText('0')).toBeVisible()
    expect(mockRequest).not.toHaveBeenCalled()
    expect(within(details).queryByText(/Next scheduled run/)).not.toBeInTheDocument()
    expect(within(details).queryByText('Changes are saved automatically.')).not.toBeInTheDocument()
    expect(within(details).queryByText('Sync settings')).not.toBeInTheDocument()
    expect(within(details).getByText('Team handbook')).toBeVisible()
    expect(within(details).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(details).getByRole('switch', { name: 'Automatic sync' })).toBeVisible()
  })

  it('does not show result counts before the first sync finishes', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [connection]
          : [{ ...source, lastFinishedAt: null, lastIndexedCount: null, lastWarningCount: null }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    await openSourceSettings(user)
    const result = within(screen.getByRole('dialog', { name: 'Source details' })).getByRole('region', {
      name: 'Last sync result'
    })
    expect(within(result).queryByText(/Documents added or updated/)).not.toBeInTheDocument()
    expect(within(result).queryByRole('button', { name: 'Sync details' })).not.toBeInTheDocument()
  })

  it('saves automatic sync immediately without a Save button or a name editor', async () => {
    const user = userEvent.setup()
    let stored = structuredClone(source)
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.schedule.update') {
        stored = { ...stored, schedule: { policy: input.policy, nextRunAt: null } }
      }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    const details = screen.getByRole('dialog', { name: 'Source details' })
    expect(within(details).queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(within(details).getByRole('switch', { name: 'Automatic sync' }))
    expect(within(details).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await waitFor(() => expect(within(details).getByRole('switch', { name: 'Automatic sync' })).toBeEnabled())
    await user.click(within(details).getByRole('button', { name: 'Close' }))
    await openSourceSettings(user)
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).toBeChecked()
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('09:00')
  })

  it('reflects a persisted daily schedule and saves disabling automatic sync', async () => {
    const user = userEvent.setup()
    let stored = {
      ...source,
      schedule: { policy: { kind: 'daily' as const, time: '10:30', timezone: 'Asia/Shanghai' }, nextRunAt: null }
    } as ExternalKnowledgeSourceListItem
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.schedule.update')
        stored = { ...stored, schedule: { policy: input.policy, nextRunAt: null } }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).toBeChecked()
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('10:30')
    expect(mockRequest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('switch', { name: 'Automatic sync' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Automatic sync' })).toBeEnabled())
    expect(stored.schedule.policy).toEqual({ kind: 'manual' })
    expect(screen.queryByLabelText('Daily sync time')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await openSourceSettings(user)
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).not.toBeChecked()
  })

  it('requires an explicit keep or remove choice when disconnecting', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect external source?' })
    expect(dialog).toHaveTextContent('Team handbook')
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

  it('shows unavailable tombstones only in source notices without a body', async () => {
    const user = userEvent.setup()
    mockDocuments.mockReturnValue({
      pages: [
        {
          items: [
            {
              id: 'document-1',
              title: 'Older document',
              availability: 'unavailable',
              currentWarning: 'resource-permission-denied',
              originalUrl: 'https://example.feishu.cn/wiki/older'
            }
          ]
        }
      ],
      isLoading: false,
      hasNext: false,
      refresh: vi.fn()
    })
    render(<SourcesHarness />)
    expect(screen.queryByText('Older document')).not.toBeInTheDocument()
    await openSourceSettings(user)
    expect(
      within(screen.getByRole('dialog', { name: 'Source details' })).getByText('Older document')
    ).toBeInTheDocument()
    expect(screen.getByText('Unavailable in the latest sync. No local body is available.')).toBeInTheDocument()
    expect(
      screen.getByText('Access is unavailable. Check the Feishu app permissions and access to this content.')
    ).toBeVisible()
  })

  it('hides document notices when all documents are healthy', async () => {
    const user = userEvent.setup()
    mockDocuments.mockReturnValue({
      pages: [
        { items: [{ id: 'document-1', title: 'Current handbook', availability: 'available', currentWarning: null }] }
      ],
      isLoading: false,
      hasNext: false,
      refresh: vi.fn()
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    expect(screen.queryByText('Document notices')).not.toBeInTheDocument()
    expect(screen.queryByText(/Items needing attention in this sync/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View in Feishu' })).not.toBeInTheDocument()
  })

  it.each([
    ['transient', 'Feishu is temporarily unavailable. Try again later.'],
    ['invalid-provider-response', 'Feishu returned incomplete document data. Try syncing again.'],
    ['unsupported-resource', 'This document type is not supported for sync.'],
    ['document-sync-failed', 'This document could not be indexed. Try syncing again.']
  ])('shows an actionable reason for a document warning: %s', async (warning, message) => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [connection]
          : [{ ...source, activeJobId: null, lastOutcome: 'completed-with-warnings', lastWarningCount: 1 }],
      refetch: vi.fn()
    }))
    const originalUrl = 'https://example.feishu.cn/wiki/handbook'
    mockDocuments.mockReturnValue({
      pages: [
        {
          items: [
            {
              id: 'document-1',
              title: 'Outdated handbook',
              availability: 'active',
              currentWarning: warning,
              originalUrl
            }
          ]
        }
      ],
      isLoading: false,
      hasNext: false,
      refresh: vi.fn()
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    expect(screen.getByText('Document notices')).toBeVisible()
    expect(screen.getByText('Outdated handbook')).toBeVisible()
    expect(screen.getByText('Items needing attention in this sync: 1')).toBeVisible()
    expect(screen.getByText(message)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'View in Feishu' }))
    expect(mockOpenExternal).toHaveBeenCalledWith(originalUrl)
    expect(screen.getByRole('button', { name: 'Manual sync' })).toBeEnabled()
  })

  it('connects a Feishu application from management and returns to the application list without creating a source', async () => {
    const user = userEvent.setup()
    const connected = {
      ...connection,
      id: 'connection-2',
      applicationName: 'Research app',
      displayName: 'Bob',
      sourceCount: 0
    }
    let connections = [connection]
    let finishAuthorization!: (value: ExternalKnowledgeConnectionListItem) => void
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? connections : [source],
      isLoading: false,
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin')
        return {
          authorizationSessionId: 'new-application-session',
          userCode: 'NEW-APP',
          verificationUri: 'https://accounts.feishu.cn/verify'
        }
      if (route === 'knowledge.feishu.authorization.complete')
        return new Promise((resolve) => {
          finishAuthorization = resolve
        })
      return undefined
    })
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.connect_application') }))
    const form = screen.getByRole('dialog', { name: i18n.t('knowledge.external.wizard.connect_application') })
    await user.type(within(form).getByLabelText('App ID'), 'cli_research')
    await user.type(within(form).getByLabelText('App Secret'), 'research-secret')
    await user.click(within(form).getByRole('button', { name: 'Connect to Feishu' }))
    expect(
      await within(form).findByText(i18n.t('knowledge.external.wizard.verification_code', { code: 'NEW-APP' }))
    ).toBeVisible()
    expect(
      within(form).getByRole('heading', { name: i18n.t('knowledge.external.wizard.connect_application') })
    ).toBeVisible()
    expect(within(form).getByRole('status').textContent).toBe(i18n.t('knowledge.external.wizard.authorizing'))
    expect(
      within(form).getByRole('img', { name: i18n.t('knowledge.external.wizard.authorization_help') })
    ).toBeVisible()
    expect(within(form).queryByLabelText('App ID')).not.toBeInTheDocument()
    expect(within(form).queryByLabelText('App Secret')).not.toBeInTheDocument()
    expect(within(form).queryByRole('button', { name: 'Connect to Feishu' })).not.toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(
      within(form).getByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') })
    ).toBeEnabled()
    expect(mockOpenExternal).toHaveBeenCalledWith('https://accounts.feishu.cn/verify')
    connections = [...connections, connected]
    await act(async () => finishAuthorization(connected))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: i18n.t('knowledge.external.wizard.connect_application') })
      ).not.toBeInTheDocument()
    )
    const manager = screen.getByRole('dialog', { name: i18n.t('knowledge.external.sources.connections') })
    expect(within(manager).getByText('Research app')).toBeVisible()
    expect(
      within(manager).getByText(i18n.t('knowledge.external.wizard.authorized_account', { name: 'Bob' }))
    ).toBeVisible()
    expect(screen.queryByText(/NEW-APP/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create source' })).not.toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.external_source.create', expect.anything())
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.external_source.schedule.update', expect.anything())
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.spaces.list', expect.anything())
  })

  it('clears failed and cancelled application authorization codes while preserving credentials for retry', async () => {
    const user = userEvent.setup()
    let attempt = 0
    let failAuthorization!: (reason: Error) => void
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin') {
        attempt += 1
        return {
          authorizationSessionId: `application-session-${attempt}`,
          userCode: attempt === 1 ? 'FIRST-CODE' : 'SECOND-CODE',
          verificationUri: 'https://accounts.feishu.cn/verify'
        }
      }
      if (route === 'knowledge.feishu.authorization.complete')
        return new Promise((_resolve, reject) => {
          failAuthorization = reject
        })
      return undefined
    })
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.connect_application') }))
    const form = screen.getByRole('dialog', { name: i18n.t('knowledge.external.wizard.connect_application') })
    await user.type(within(form).getByLabelText('App ID'), 'cli_research')
    await user.type(within(form).getByLabelText('App Secret'), 'retry-secret')
    await user.click(within(form).getByRole('button', { name: 'Connect to Feishu' }))
    expect(
      await within(form).findByText(i18n.t('knowledge.external.wizard.verification_code', { code: 'FIRST-CODE' }))
    ).toBeVisible()
    await act(async () => failAuthorization(new Error('raw secret provider failure')))

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      i18n.t('knowledge.external.wizard.authorization_error')
    )
    expect(within(form).getByRole('alert')).not.toHaveTextContent('raw secret provider failure')
    expect(screen.queryByText(/FIRST-CODE/)).not.toBeInTheDocument()
    expect(
      within(form).queryByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') })
    ).not.toBeInTheDocument()
    expect(within(form).getByLabelText('App ID')).toHaveValue('cli_research')
    expect(within(form).getByLabelText('App Secret')).toHaveValue('retry-secret')
    await user.click(within(form).getByRole('button', { name: 'Connect to Feishu' }))
    expect(
      await within(form).findByText(i18n.t('knowledge.external.wizard.verification_code', { code: 'SECOND-CODE' }))
    ).toBeVisible()
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))

    expect(
      screen.queryByRole('dialog', { name: i18n.t('knowledge.external.wizard.connect_application') })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: i18n.t('knowledge.external.sources.connections') })).toBeVisible()
    expect(screen.queryByText(/SECOND-CODE/)).not.toBeInTheDocument()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.cancel', {
      authorizationSessionId: 'application-session-2'
    })
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.connect_application') }))
    expect(screen.getByLabelText('App Secret')).toHaveValue('')
    expect(
      screen.queryByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') })
    ).not.toBeInTheDocument()
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
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    const panel = screen.getByRole('dialog', { name: i18n.t('knowledge.external.sources.connections') })
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

  it('keeps the persisted daily time when an incomplete time is blurred', async () => {
    const user = userEvent.setup()
    let stored = {
      ...source,
      schedule: { policy: { kind: 'daily' as const, time: '10:30', timezone: 'Asia/Shanghai' }, nextRunAt: null }
    }
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.schedule.update')
        stored = { ...stored, schedule: { policy: input.policy, nextRunAt: null } }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await user.clear(screen.getByLabelText('Daily sync time'))
    await user.tab()
    expect(screen.getByLabelText('Daily sync time')).toBeInvalid()
    expect(screen.getByText('Required field')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await openSourceSettings(user)
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('10:30')
    fireEvent.change(screen.getByLabelText('Daily sync time'), { target: { value: '12:15' } })
    fireEvent.blur(screen.getByLabelText('Daily sync time'))
    await waitFor(() => expect(screen.getByLabelText('Daily sync time')).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await openSourceSettings(user)
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('12:15')
    expect(screen.getByText('Time zone: Asia/Shanghai')).toBeInTheDocument()
  })

  it.each(['close', 'escape'] as const)('saves the focused time before closing with %s', async (method) => {
    const user = userEvent.setup()
    let stored = {
      ...source,
      schedule: { policy: { kind: 'daily' as const, time: '10:30', timezone: 'Asia/Shanghai' }, nextRunAt: null }
    }
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.schedule.update')
        stored = { ...stored, schedule: { policy: input.policy, nextRunAt: null } }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus())
    const time = screen.getByLabelText('Daily sync time')
    await user.click(time)
    fireEvent.change(time, { target: { value: '12:15' } })
    if (method === 'close') await user.click(screen.getByRole('button', { name: 'Close' }))
    else await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await openSourceSettings(user)
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('12:15')
  })

  it('saves a time after focus moves through the frequency controls', async () => {
    const user = userEvent.setup()
    let stored = {
      ...source,
      schedule: { policy: { kind: 'daily' as const, time: '10:30', timezone: 'Asia/Shanghai' }, nextRunAt: null }
    }
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.schedule.update')
        stored = { ...stored, schedule: { policy: input.policy, nextRunAt: null } }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus())
    const time = screen.getByLabelText('Daily sync time')
    await user.click(time)
    fireEvent.change(time, { target: { value: '12:15' } })
    await user.tab({ shift: true })
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Sync details' }))
    await waitFor(() => expect(stored.schedule.policy.time).toBe('12:15'))
  })

  it('locks the schedule during automatic saving and rolls back after failure', async () => {
    const user = userEvent.setup()
    let failSave!: (error: Error) => void
    mockRequest.mockReturnValue(
      new Promise<void>((_, reject) => {
        failSave = reject
      })
    )
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await user.click(screen.getByRole('switch', { name: 'Automatic sync' }))
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Sync settings' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => failSave(new Error('Schedule unavailable')))
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Automatic sync' })).toBeEnabled()
    expect(screen.getByRole('region', { name: 'Sync settings' })).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent('Schedule unavailable')
  })

  it('shows a failed sync reason and offers retry in its details', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [connection]
          : [{ ...source, activeJobId: null, lastOutcome: 'failed', lastErrorSummary: 'timeout' }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    expect(screen.getByRole('alert')).toHaveTextContent('1 source(s) need attention')
    await openSourceSettings(user)
    const details = screen.getByRole('dialog', { name: 'Source details' })
    expect(within(details).getByText('Sync timed out. Try again.')).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Manual sync' })).toBeEnabled()
  })

  it('disables sync for paused sources and keeps reauthorization available', async () => {
    const user = userEvent.setup()
    mockQuery.mockImplementation((path: string) => ({
      data:
        path === '/external-knowledge-connections'
          ? [{ ...connection, authorizationStatus: 'reauthorization-required' }]
          : [{ ...source, activeJobId: null, state: 'paused' }],
      refetch: vi.fn()
    }))
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: '1 source(s) need attention' }))
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sync is paused. Check the account connection.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByRole('button', { name: 'Manual sync' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sync is paused. Check the account connection.')).not.toBeInTheDocument()
  })

  it('starts a manual sync for the selected connected source and prevents another active run', async () => {
    const user = userEvent.setup()
    let stored: ExternalKnowledgeSourceListItem = { ...source, activeJobId: null }
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.sync') {
        if (input.sourceId !== source.id) throw new Error('Wrong source')
        stored = { ...stored, activeJobId: 'job-1' }
      }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await user.click(screen.getByRole('button', { name: 'Manual sync' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manual sync' })).toBeDisabled())
    expect(screen.getByRole('dialog', { name: 'Source details' })).toHaveTextContent('Syncing · Stage: Reading')
  })

  it.each(['complete', 'cancel', 'failure'] as const)(
    'only starts a manual sync after successful reauthorization: %s',
    async (outcome) => {
      const user = userEvent.setup()
      let stored = { ...source, state: 'paused' as const, activeJobId: null } as ExternalKnowledgeSourceListItem
      let authorize!: () => void
      let rejectAuthorization!: (error: Error) => void
      let syncedSourceId: string | null = null
      mockQuery.mockImplementation((path: string) => ({
        data:
          path === '/external-knowledge-connections'
            ? [{ ...connection, authorizationStatus: 'reauthorization-required' }]
            : [stored],
        refetch: vi.fn()
      }))
      mockRequest.mockImplementation(async (route, input) => {
        if (route === 'knowledge.feishu.connection.reconnect')
          return {
            authorizationSessionId: 'session-1',
            verificationUri: 'https://feishu.example/verify',
            userCode: 'ABCD'
          }
        if (route === 'knowledge.feishu.authorization.complete') {
          await new Promise<void>((resolve, reject) => {
            authorize = resolve
            rejectAuthorization = reject
          })
          stored = { ...stored, state: 'active' }
        }
        if (route === 'knowledge.external_source.sync') {
          syncedSourceId = input.sourceId
          stored = { ...stored, activeJobId: 'job-1' }
        }
        return undefined
      })
      const { rerender } = render(<SourcesHarness />)
      await openSourceSettings(user)
      await user.click(screen.getByRole('button', { name: 'Manual sync' }))
      const authorization = await screen.findByRole('dialog', { name: 'Reconnect' })
      expect(syncedSourceId).toBeNull()
      if (outcome === 'cancel') await user.click(within(authorization).getByRole('button', { name: 'Cancel' }))
      await act(async () => {
        if (outcome === 'failure') rejectAuthorization(new Error('Authorization failed'))
        else authorize()
      })
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reconnect' })).not.toBeInTheDocument())
      if (outcome === 'complete') {
        await waitFor(() => expect(syncedSourceId).toBe(source.id))
        // The query stub has no subscription to deliver the refreshed source projection.
        rerender(<SourcesHarness />)
        expect(screen.getByRole('button', { name: 'Manual sync' })).toBeDisabled()
      } else {
        expect(syncedSourceId).toBeNull()
        expect(screen.getByRole('button', { name: 'Manual sync' })).toBeEnabled()
      }
    }
  )

  it('lets users replace custom app credentials while keeping the source connection', async () => {
    const user = userEvent.setup()
    let complete!: () => void
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.feishu.connection.reconnect') {
        if (
          input.connectionId !== 'connection-1' ||
          input.credentials?.appId !== 'cli_updated' ||
          input.credentials?.appSecret !== 'new-secret'
        )
          throw new Error('Replacement credentials were not supplied')
        return {
          authorizationSessionId: 'updated-session',
          verificationUri: 'https://feishu.example/verify',
          userCode: 'RECONNECT'
        }
      }
      if (route === 'knowledge.feishu.authorization.complete')
        await new Promise<void>((resolve) => {
          complete = resolve
        })
      return undefined
    })
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    await user.click(screen.getByRole('button', { name: 'Edit app configuration' }))
    const form = screen.getByRole('dialog', { name: 'Edit app configuration' })
    expect(form).toHaveTextContent('Alice')
    expect(within(form).getByLabelText('App ID')).toHaveValue('cli_original')
    expect(within(form).getByLabelText('App Secret')).toHaveAttribute('type', 'password')
    expect(within(form).getByRole('button', { name: 'Save and reconnect' })).toBeDisabled()
    await user.clear(within(form).getByLabelText('App ID'))
    await user.type(within(form).getByLabelText('App ID'), 'cli_updated')
    await user.type(within(form).getByLabelText('App Secret'), 'new-secret')
    await user.click(within(form).getByRole('button', { name: 'Save and reconnect' }))
    const authorization = await screen.findByRole('dialog', { name: 'Reconnect' })
    expect(authorization).toHaveTextContent('RECONNECT')
    expect(
      within(authorization).queryByText(i18n.t('knowledge.external.wizard.authorization_help'))
    ).not.toBeInTheDocument()
    expect(within(authorization).getByRole('status').textContent).toBe(i18n.t('knowledge.external.wizard.authorizing'))
    expect(
      within(authorization).getByRole('img', { name: i18n.t('knowledge.external.wizard.authorization_help') })
    ).toBeVisible()
    expect(
      within(authorization).getByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') })
    ).toBeEnabled()
    expect(within(authorization).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Save and reconnect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'App ID' })).not.toBeInTheDocument()
    await act(async () => complete())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reconnect' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: i18n.t('knowledge.external.sources.connections') })).toHaveTextContent(
      'Used by 1 source(s)'
    )
    await user.click(screen.getByRole('button', { name: 'Edit app configuration' }))
    expect(screen.getByLabelText('App Secret')).toHaveValue('')
  })

  it('keeps credential edits available after reconnect fails', async () => {
    const user = userEvent.setup()
    mockRequest.mockRejectedValue(new Error('Authorization unavailable'))
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    await user.click(screen.getByRole('button', { name: 'Edit app configuration' }))
    await user.type(screen.getByLabelText('App Secret'), 'replacement-secret')
    await user.click(screen.getByRole('button', { name: 'Save and reconnect' }))
    const form = screen.getByRole('dialog', { name: 'Edit app configuration' })
    expect(within(form).getByRole('alert')).toHaveTextContent('Authorization unavailable')
    expect(within(form).getByRole('button', { name: 'Save and reconnect' })).toBeEnabled()
    expect(within(form).getByLabelText('App ID')).toHaveValue('cli_original')
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit app configuration' }))
    expect(screen.getByLabelText('App Secret')).toHaveValue('')
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
    render(<SourcesHarness />)
    await openSourceSettings(user)
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
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Disconnect external source?' })).not.toBeInTheDocument()
    )
  })

  it('clears disconnect progress after failure and allows retrying the other choice', async () => {
    const user = userEvent.setup()
    let failDisconnect!: (reason: Error) => void
    mockRequest.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        failDisconnect = reject
      })
    )
    render(<SourcesHarness />)
    await openSourceSettings(user)
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
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Disconnect external source?' })).not.toBeInTheDocument()
    )
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
    render(<SourcesHarness />)
    await openSourceSettings(user)
    expect(screen.queryByText('No document notices.')).not.toBeInTheDocument()
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
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.sources.manage_connections') }))
    await user.click(
      within(screen.getByRole('dialog', { name: i18n.t('knowledge.external.sources.connections') })).getByRole(
        'button',
        { name: 'Delete' }
      )
    )
    const dialog = screen.getByRole('dialog', { name: 'Remove connection?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
})
