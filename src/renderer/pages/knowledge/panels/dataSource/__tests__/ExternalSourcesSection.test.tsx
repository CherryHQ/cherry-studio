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
  ...(await import('@cherrystudio/ui/components/primitives/combobox')),
  ...(await import('@cherrystudio/ui/components/primitives/input')),
  ...(await import('@cherrystudio/ui/components/primitives/field')),
  ...(await import('@cherrystudio/ui/components/primitives/label')),
  ...(await import('@cherrystudio/ui/components/primitives/tooltip')),
  ...(await import('@cherrystudio/ui/components/composites/icon-tooltips')),
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
  await user.click(within(manager).getByRole('button', { name: 'Team handbook' }))
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
    expect(manager).toHaveTextContent('Sync timed out. Try again.')
    expect(within(manager).getByRole('button', { name: 'Retry sync' })).toBeEnabled()
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

  it('keeps keyboard focus in source settings and restores the source entry when going back', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    await waitFor(() => expect(manager).toHaveFocus())

    await user.click(within(manager).getByRole('button', { name: 'Team handbook' }))
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Team handbook' })).toHaveFocus()

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Team handbook' })).toHaveFocus()
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

  it('saves a changed name once and returns after one Back click while saving is delayed', async () => {
    const user = userEvent.setup()
    let finishRename!: () => void
    mockRequest.mockImplementation((route: string) =>
      route === 'knowledge.external_source.rename'
        ? new Promise<void>((resolve) => {
            finishRename = resolve
          })
        : Promise.resolve(undefined)
    )
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await user.clear(screen.getByLabelText('Source name'))
    await user.type(screen.getByLabelText('Source name'), 'New handbook')
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(mockRequest).toHaveBeenCalledExactlyOnceWith('knowledge.external_source.rename', {
      sourceId: 'source-1',
      name: 'New handbook'
    })
    await act(async () => finishRename())
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sync sources' })).toBeVisible())
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Team handbook' })).toHaveFocus()
  })

  it('shows a brief syncing status and puts detailed progress and account information in management', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    expect(screen.getByRole('status')).toHaveTextContent('1 source(s) syncing')
    expect(screen.queryByText('Syncing · Stage: Reading')).not.toBeInTheDocument()
    expect(screen.queryByText(/Last sync: 2 indexed, 1 unchanged/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
    const manager = screen.getByRole('dialog', { name: 'Sync sources' })
    expect(manager).toHaveTextContent('Alice · Node · space-1')
    expect(manager).toHaveTextContent('Syncing · Stage: Reading')
    expect(within(manager).getByText(/Last sync: 2 indexed, 1 unchanged/)).toBeInTheDocument()
    expect(within(manager).getByText(/Last successful sync/)).toBeInTheDocument()
    expect(within(manager).getByText(/Next scheduled run: Never/)).toBeInTheDocument()
  })

  it('saves frequency immediately without requiring a name or a Save button', async () => {
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
    const details = screen.getByRole('dialog', { name: 'Team handbook' })
    await user.clear(within(details).getByLabelText('Source name'))
    await user.click(within(details).getByRole('radio', { name: 'Daily' }))
    expect(within(details).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await waitFor(() => expect(within(details).getByRole('radio', { name: 'Daily' })).toBeEnabled())
    await user.click(within(details).getByRole('button', { name: 'Close' }))
    await openSourceSettings(user)
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked()
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('09:00')
  })

  it('commits an edited name on blur independently of the schedule', async () => {
    const user = userEvent.setup()
    let stored = structuredClone(source)
    mockQuery.mockImplementation((path: string) => ({
      data: path === '/external-knowledge-connections' ? [connection] : [stored],
      refetch: vi.fn()
    }))
    mockRequest.mockImplementation(async (route, input) => {
      if (route === 'knowledge.external_source.rename') stored = { ...stored, name: input.name }
    })
    render(<SourcesHarness />)
    await openSourceSettings(user)
    await user.clear(screen.getByLabelText('Source name'))
    await user.type(screen.getByLabelText('Source name'), 'Updated handbook{Enter}')
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Updated handbook' })).toBeInTheDocument())
    expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('requires an explicit keep or remove choice when disconnecting', async () => {
    const user = userEvent.setup()
    render(<SourcesHarness />)
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
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
        { items: [{ id: 'document-1', title: 'Older document', availability: 'unavailable', currentWarning: null }] }
      ],
      isLoading: false,
      hasNext: false,
      refresh: vi.fn()
    })
    render(<SourcesHarness />)
    expect(screen.queryByText('Older document')).not.toBeInTheDocument()
    await openSourceSettings(user)
    expect(
      within(screen.getByRole('dialog', { name: 'Team handbook' })).getByText('Older document')
    ).toBeInTheDocument()
    expect(screen.getByText('Unavailable in the latest sync. No local body is available.')).toBeInTheDocument()
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
    expect(screen.getByRole('radio', { name: 'Daily' })).toHaveFocus()
    await user.click(screen.getByLabelText('Source name'))
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
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeDisabled()
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    await act(async () => failSave(new Error('Schedule unavailable')))
    expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeEnabled()
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
    const details = screen.getByRole('dialog', { name: 'Team handbook' })
    expect(within(details).getByText('Sync timed out. Try again.')).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Retry sync' })).toBeEnabled()
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
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
    expect(screen.getByText('Sync is paused. Check the account connection.')).toBeInTheDocument()
  })

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
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
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
    await user.click(screen.getByRole('button', { name: 'Sync sources' }))
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
