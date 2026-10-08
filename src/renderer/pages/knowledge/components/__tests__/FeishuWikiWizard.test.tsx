import { MockUseDataApiUtils, mockUseInvalidateCache, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { ExternalKnowledgeConnectionListItem } from '@shared/data/api/schemas/externalKnowledgeConnections'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import FeishuWikiWizard from '../FeishuWikiWizard'

const mockRequest = vi.fn()
const mockInvalidate = vi.fn(async () => undefined)
const mockOpenExternal = vi.fn(async () => undefined)

vi.mock('@cherrystudio/ui', async () => ({
  ...(await import('@cherrystudio/ui/components/primitives/accordion')),
  ...(await import('@cherrystudio/ui/components/primitives/button')),
  ...(await import('@cherrystudio/ui/components/primitives/combobox')),
  ...(await import('@cherrystudio/ui/components/primitives/dialog')),
  ...(await import('@cherrystudio/ui/components/primitives/input')),
  ...(await import('@cherrystudio/ui/components/primitives/field')),
  ...(await import('@cherrystudio/ui/components/primitives/label')),
  ...(await import('@cherrystudio/ui/components/primitives/segmented-control')),
  ...(await import('@cherrystudio/ui/components/primitives/tooltip')),
  ...(await import('@cherrystudio/ui/components/composites/icon-tooltips'))
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => mockRequest(...args) } }))

const connection: ExternalKnowledgeConnectionListItem = {
  id: '0199c87a-1200-7000-8000-000000000001',
  displayName: 'Alice',
  authorizationStatus: 'connected',
  provider: 'feishu',
  appId: 'cli_alice',
  appCredentialSource: 'custom-app',
  accountUserId: 'alice',
  accountOpenId: 'open-alice',
  accountUnionId: null,
  tenantKey: 'acme',
  avatarUrl: null,
  applicationName: 'Team Wiki',
  sourceCount: 0,
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
const authorizationStart = {
  authorizationSessionId: '55555555-5555-4555-8555-555555555555',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://accounts.feishu.cn/verify'
}
const registration = {
  registrationSessionId: 'registration-1',
  verificationUri: 'https://accounts.feishu.cn/register'
}
const url = 'https://acme.feishu.cn/wiki/wikcnNode'
const preview = {
  resolution: {
    account: { displayName: 'Alice' },
    tenantId: 'tenant-1',
    scope: { kind: 'node', nodeId: 'wikcnNode' },
    selected: { title: 'Team handbook', documentKind: 'document' }
  },
  visibleNodeCount: 4,
  supportedDocxCount: 3,
  unsupportedOrSkippedCount: 1,
  supportedDocuments: [
    { nodeId: 'handbook', title: 'Team handbook', documentKind: 'document' as const },
    { nodeId: 'onboarding', title: 'Employee onboarding', documentKind: 'document' as const },
    { nodeId: 'security', title: 'Security guide', documentKind: 'document' as const }
  ],
  skippedItems: [
    {
      nodeId: 'metrics',
      title: 'Quarterly metrics',
      documentKind: 'spreadsheet' as const,
      reason: 'unsupported-type' as const
    }
  ],
  warnings: []
}
const createdSource = { id: '0199c87a-1200-7000-8000-000000000002' }
const space = { spaceId: 'space-1', name: 'Project Wiki', description: 'Shared project documents' }
const spacePreview = {
  space,
  visibleNodeCount: 8,
  supportedDocxCount: 5,
  unsupportedOrSkippedCount: 3,
  supportedDocuments: [
    ...preview.supportedDocuments,
    { nodeId: 'roadmap', title: 'Product roadmap', documentKind: 'document' as const },
    { nodeId: 'release', title: 'Release checklist', documentKind: 'document' as const }
  ],
  skippedItems: [
    ...preview.skippedItems,
    {
      nodeId: 'reference',
      title: 'Reference materials',
      documentKind: 'document' as const,
      reason: 'cross-space-shortcut' as const
    },
    {
      nodeId: 'reference',
      title: 'Reference shortcut',
      documentKind: 'document' as const,
      reason: 'cross-space-shortcut' as const
    }
  ],
  embeddingCostExact: false,
  warnings: []
}

async function openWikiOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' }))
}

async function selectWiki(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await openWikiOptions(user)
  await user.click(await screen.findByRole('option', { name }))
  await user.keyboard('{Escape}')
}

async function selectApplication(user: ReturnType<typeof userEvent.setup>, name: string | RegExp = /Team Wiki.*Alice/) {
  await user.click(screen.getByRole('button', { name: /^Feishu app / }))
  await user.click(await screen.findByRole('option', { name }))
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await selectApplication(user)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('radio', { name: 'Paste a link' }))
  await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Add Feishu Wiki' })
  await screen.findByRole('radio', { name: 'Daily' })
}

describe('FeishuWikiWizard', () => {
  beforeAll(async () => {
    Element.prototype.scrollIntoView = vi.fn()
    await i18n.changeLanguage('en-US')
  })
  beforeEach(() => {
    mockRequest.mockReset()
    mockInvalidate.mockClear()
    mockUseQuery.mockReset()
    mockUseInvalidateCache.mockReturnValue(mockInvalidate)
    mockOpenExternal.mockClear()
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: [connection],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.space.preview') return spacePreview
      if (route === 'knowledge.feishu.scope.preview') return preview
      if (route === 'knowledge.external_source.create') return createdSource
      return undefined
    })
    Object.assign(window.api, { shell: { openExternal: mockOpenExternal } })
  })

  it('starts with editable credentials and no permission choices when no usable account exists', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
    const { rerender } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /^Feishu app / })).not.toBeInTheDocument()
    expect(screen.queryByText('No connected Feishu accounts yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    const connect = screen.getByRole('button', { name: 'Connect to Feishu' })
    expect(connect).toBeDisabled()
    await user.type(screen.getByLabelText('App ID'), 'cli_test')
    await user.type(screen.getByLabelText('App Secret'), 'secret')
    expect(connect).toBeEnabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument()

    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: [{ ...connection, authorizationStatus: 'reauthorization-required' }]
    })
    rerender(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    expect(screen.getByLabelText('App ID')).toHaveValue('cli_test')
    expect(screen.getByLabelText('App Secret')).toHaveValue('secret')
    expect(
      screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.reauthorize', { name: 'Alice' }) })
    ).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Feishu app / })).not.toBeInTheDocument()
  })

  it('shows only authorization guidance while hiding credentials and other applications during authorization', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: [{ ...connection, authorizationStatus: 'reauthorization-required' }]
    })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin') return authorizationStart
      if (route === 'knowledge.feishu.authorization.complete') return new Promise(() => undefined)
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await user.type(screen.getByLabelText('App ID'), 'cli_new')
    await user.type(screen.getByLabelText('App Secret'), 'new-secret')
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))

    expect(
      await screen.findByText(
        i18n.t('knowledge.external.wizard.verification_code', { code: authorizationStart.userCode })
      )
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Add Feishu Wiki' })).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe(i18n.t('knowledge.external.wizard.authorizing'))
    expect(screen.queryByLabelText('App ID')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('App Secret')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect to Feishu' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: i18n.t('knowledge.external.wizard.create_app') })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByText(i18n.t('knowledge.external.wizard.authorization_help'))).not.toBeInTheDocument()
    const help = screen.getByRole('img', { name: i18n.t('knowledge.external.wizard.authorization_help') })
    await user.hover(help)
    expect(
      await screen.findByRole('tooltip', { name: i18n.t('knowledge.external.wizard.authorization_help') })
    ).toBeVisible()
    mockOpenExternal.mockClear()
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') }))
    expect(mockOpenExternal).toHaveBeenCalledExactlyOnceWith(authorizationStart.verificationUri)
    expect(mockRequest.mock.calls.filter(([route]) => route === 'knowledge.feishu.authorization.begin')).toHaveLength(1)
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.connection.reconnect', expect.anything())
  })

  it('preserves a new application draft after an existing application reauthorization fails', async () => {
    const user = userEvent.setup()
    let failAuthorization!: (reason: Error) => void
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: [{ ...connection, authorizationStatus: 'reauthorization-required' }]
    })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.connection.reconnect' || route === 'knowledge.feishu.authorization.begin')
        return authorizationStart
      if (route === 'knowledge.feishu.authorization.complete')
        return new Promise((_resolve, reject) => {
          failAuthorization = reject
        })
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await user.type(screen.getByLabelText('App ID'), 'cli_draft')
    await user.type(screen.getByLabelText('App Secret'), 'draft-secret')
    await user.click(screen.getByRole('button', { name: 'Reconnect Alice' }))
    await screen.findByText(
      i18n.t('knowledge.external.wizard.verification_code', { code: authorizationStart.userCode })
    )
    expect(screen.queryByRole('textbox', { name: 'App ID' })).not.toBeInTheDocument()
    await act(async () => failAuthorization(new Error('Authorization unavailable')))

    await screen.findByRole('alert')
    expect(screen.getByLabelText('App ID')).toHaveValue('cli_draft')
    expect(screen.getByLabelText('App Secret')).toHaveValue('draft-secret')
    expect(screen.getByRole('button', { name: 'Connect to Feishu' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
    await screen.findByText(
      i18n.t('knowledge.external.wizard.verification_code', { code: authorizationStart.userCode })
    )
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'custom-app',
      appId: 'cli_draft',
      appSecret: 'draft-secret',
      includeSpaceDiscovery: true
    })
  })

  it.each(['space', 'url'] as const)(
    'keeps pending authorization mounted when connections refresh and continues to the chosen %s scope',
    async (scopeMode) => {
      const user = userEvent.setup()
      let completeAuthorization!: (value: ExternalKnowledgeConnectionListItem) => void
      MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
      mockRequest.mockImplementation(async (route: string, input?: { includeSpaceDiscovery?: boolean }) => {
        if (route === 'knowledge.feishu.authorization.begin') {
          if (scopeMode === 'url' && input?.includeSpaceDiscovery !== false)
            throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Missing discovery permission')
          return authorizationStart
        }
        if (route === 'knowledge.feishu.authorization.complete')
          return new Promise((resolve) => {
            completeAuthorization = resolve
          })
        if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
        return undefined
      })
      const { rerender } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
      await user.type(screen.getByLabelText('App ID'), 'cli_new')
      await user.type(screen.getByLabelText('App Secret'), 'new-secret')
      await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
      if (scopeMode === 'url')
        await user.click(await screen.findByRole('button', { name: 'Continue with a link only' }))
      await screen.findByText(
        i18n.t('knowledge.external.wizard.verification_code', { code: authorizationStart.userCode })
      )
      MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [connection] })
      rerender(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

      expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.authorization.cancel', {
        authorizationSessionId: authorizationStart.authorizationSessionId
      })
      expect(
        screen.getByText(i18n.t('knowledge.external.wizard.verification_code', { code: authorizationStart.userCode }))
      ).toBeVisible()
      await act(async () => completeAuthorization(connection))
      expect(
        await screen.findByRole('radio', { name: scopeMode === 'url' ? 'Paste a link' : 'Choose Wikis' })
      ).toBeChecked()
      if (scopeMode === 'url') {
        expect(screen.getByRole('textbox', { name: 'Feishu Wiki URL' })).toBeVisible()
        expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.spaces.list', expect.anything())
      } else {
        expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
      }
    }
  )

  it('hides stale initial-authorization failures while keeping the credentials form available', () => {
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: [
        {
          ...connection,
          authorizationStatus: 'reauthorization-required',
          authorizedAt: null,
          accountUserId: null,
          accountOpenId: null,
          tenantKey: null,
          displayName: null,
          grantedScopes: []
        }
      ]
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText('App ID')).toBeEnabled()
    expect(screen.getByLabelText('App Secret')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Connect to Feishu' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Feishu app / })).not.toBeInTheDocument()
  })

  it('selects a single Feishu application with its authorized account and preserves connections sharing an app ID', async () => {
    const user = userEvent.setup()
    const bob = { ...connection, id: '0199c87a-1200-7000-8000-000000000003', displayName: 'Bob' }
    const unnamed = {
      ...connection,
      id: '0199c87a-1200-7000-8000-000000000004',
      applicationName: null,
      appId: 'cli_unnamed'
    }
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [connection, bob, unnamed] })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    expect(screen.queryByLabelText('App ID')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use another app' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^Feishu app / }))
    const aliceOption = screen.getByRole('option', { name: /Team Wiki.*Alice/ })
    const bobOption = screen.getByRole('option', { name: /Team Wiki.*Bob/ })
    expect(aliceOption).toHaveTextContent(/^Team Wiki/)
    expect(
      within(aliceOption).getByText(i18n.t('knowledge.external.wizard.authorized_account', { name: 'Alice' }))
    ).toBeVisible()
    expect(
      within(bobOption).getByText(i18n.t('knowledge.external.wizard.authorized_account', { name: 'Bob' }))
    ).toBeVisible()
    expect(screen.getByRole('option', { name: /cli_unnamed.*Alice/ })).toBeVisible()
    await user.click(bobOption)
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Feishu app / })).toHaveTextContent(
      i18n.t('knowledge.external.wizard.authorized_account', { name: 'Bob' })
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.spaces.list', {
      connectionId: bob.id,
      pageToken: undefined
    })

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await selectApplication(user, /cli_unnamed.*Alice/)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
    expect(mockRequest).toHaveBeenLastCalledWith('knowledge.feishu.spaces.list', {
      connectionId: unnamed.id,
      pageToken: undefined
    })
  })

  it('creates an app from the discoverable help icon and advances after authorization without credential re-entry', async () => {
    const user = userEvent.setup()
    let finishRegistration!: (value: typeof authorizationStart) => void
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.registration.begin') return registration
      if (route === 'knowledge.feishu.authorization.begin')
        return new Promise((resolve) => {
          finishRegistration = resolve
        })
      if (route === 'knowledge.feishu.authorization.complete') return connection
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    const create = screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.create_app') })
    expect(create).toHaveTextContent(/^$/)
    await user.hover(create)
    expect(await screen.findByRole('tooltip', { name: i18n.t('knowledge.external.wizard.create_app') })).toBeVisible()
    await user.click(create)
    expect(await screen.findByRole('status')).toHaveTextContent('Waiting for Feishu app registration')
    expect(mockOpenExternal).toHaveBeenCalledWith(registration.verificationUri)
    expect(screen.getByLabelText('App ID')).toHaveValue('')
    await act(async () => finishRegistration(authorizationStart))

    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'personal-agent',
      registrationSessionId: registration.registrationSessionId
    })
    expect(mockOpenExternal).toHaveBeenCalledWith(authorizationStart.verificationUri)
    expect(screen.queryByLabelText('App Secret')).not.toBeInTheDocument()
  })

  it('explains app registration failure, permits a retry, and cancels when closing the waiting wizard', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
    let attempts = 0
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.registration.begin' && attempts++ === 0)
        throw new IpcError(knowledgeErrorCodes.FEISHU_REGISTRATION_FAILED, 'raw secret detail')
      if (route === 'knowledge.feishu.registration.begin') return registration
      if (route === 'knowledge.feishu.authorization.begin') return new Promise(() => undefined)
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.create_app') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create a Feishu app. Try again or enter an existing app’s credentials.'
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent('raw secret detail')
    expect(screen.getByLabelText('App Secret')).toBeEnabled()
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.create_app') }))
    expect(await screen.findByRole('status')).toHaveTextContent('Waiting for Feishu app registration')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.registration.cancel', {
      registrationSessionId: registration.registrationSessionId
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates a source with manual sync selected by default without adding a daily schedule', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<FeishuWikiWizard open baseId="00000000-0000-4000-8000-000000000001" onOpenChange={onOpenChange} />)

    await reachReview(user)
    expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked()
    expect(screen.queryByLabelText('Daily sync time')).not.toBeInTheDocument()
    expect(screen.getByText('Documents to sync: 3')).toBeInTheDocument()
    expect(screen.getByText('Items to skip: 1')).toBeInTheDocument()
    expect(screen.getByText('Team handbook')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Source name' })).not.toBeInTheDocument()
    expect(screen.queryByText('4 visible nodes')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Time zone:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.create', {
      baseId: '00000000-0000-4000-8000-000000000001',
      connectionId: connection.id,
      url,
      name: 'Team handbook'
    })
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.external_source.schedule.update', expect.anything())
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.external_source.sync', expect.anything())
    expect(mockInvalidate).toHaveBeenCalledWith('/knowledge-bases/:id/external-knowledge-sources')
  })

  it.each(['hover', 'keyboard focus'])('reveals synchronization costs through icon %s', async (interaction) => {
    const user = userEvent.setup()
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await reachReview(user)

    const explanation =
      "Syncing documents with a paid model may incur charges. The amount depends on the volume of document content and the model's pricing."
    const costInfo = screen.getByRole('img', { name: 'Synchronization costs' })
    expect(screen.queryByText(explanation)).not.toBeInTheDocument()

    if (interaction === 'hover') {
      await user.hover(costInfo)
    } else {
      await user.click(screen.getByRole('radio', { name: 'Manual' }))
      await user.tab({ shift: true })
      expect(costInfo).toHaveFocus()
    }

    expect(await screen.findByRole('tooltip')).toHaveTextContent(explanation)
  })

  it('keeps preview details collapsed until the user expands documents or skipped reasons', async () => {
    const user = userEvent.setup()
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await reachReview(user)

    const documents = screen.getByRole('button', { name: 'Documents to sync: 3 View documents' })
    const reasons = screen.getByRole('button', { name: 'Items to skip: 1 View reasons' })
    expect(documents).toHaveAttribute('aria-expanded', 'false')
    expect(reasons).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Employee onboarding')).not.toBeInTheDocument()
    expect(screen.queryByText('Quarterly metrics')).not.toBeInTheDocument()

    await user.click(documents)
    expect(await screen.findByText('Employee onboarding')).toBeVisible()
    expect(screen.getByText('Security guide')).toBeVisible()
    expect(screen.queryByText('Quarterly metrics')).not.toBeInTheDocument()
    await user.click(reasons)
    const skipped = screen.getByRole('region', { name: 'Items to skip: 1 View reasons' })
    expect(within(skipped).getByText('Quarterly metrics')).toBeVisible()
    expect(within(skipped).getByText('Spreadsheet')).toBeVisible()
    expect(within(skipped).getByText('This content type is not supported yet.')).toBeVisible()
    expect(documents).toHaveAttribute('aria-expanded', 'true')
    expect(reasons).toHaveAttribute('aria-expanded', 'true')
  })

  it('omits the skipped-details control when every previewed document can sync', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview')
        return { ...preview, visibleNodeCount: 3, unsupportedOrSkippedCount: 0, skippedItems: [] }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await reachReview(user)

    expect(screen.getByRole('button', { name: 'Documents to sync: 3 View documents' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /View reasons/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Items to skip: 0')).not.toBeInTheDocument()
  })

  it('explains an empty sync preview and hides a zero skipped count', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview')
        return {
          ...preview,
          visibleNodeCount: 0,
          supportedDocxCount: 0,
          unsupportedOrSkippedCount: 0,
          supportedDocuments: [],
          skippedItems: [],
          warnings: ['no-supported-documents']
        }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await reachReview(user)

    expect(screen.getByRole('status')).toHaveTextContent('No documents available to sync.')
    expect(screen.queryByText('Documents to sync: 0')).not.toBeInTheDocument()
    expect(screen.queryByText('Items to skip: 0')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View documents|View reasons/ })).not.toBeInTheDocument()
  })

  it('keeps skipped reasons available when no previewed documents can sync', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview')
        return {
          ...preview,
          visibleNodeCount: 1,
          supportedDocxCount: 0,
          supportedDocuments: [],
          warnings: ['no-supported-documents']
        }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await reachReview(user)

    expect(screen.getByRole('status')).toHaveTextContent('No documents available to sync.')
    expect(screen.queryByRole('button', { name: /View documents/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Items to skip: 1 View reasons' }))
    expect(screen.getByText('Quarterly metrics')).toBeVisible()
    expect(screen.getByText('This content type is not supported yet.')).toBeVisible()
  })

  it('allows enabling daily sync before creating a source', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)
    await reachReview(user)
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked()
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('09:00')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.schedule.update', {
      sourceId: createdSource.id,
      policy: { kind: 'daily', time: '09:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
    })
  })

  it('keeps the URL step available when preview fails, then permits a retry', async () => {
    const user = userEvent.setup()
    let previewAttempts = 0
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview' && previewAttempts++ === 0) {
        throw new Error('Temporary provider failure')
      }
      if (route === 'knowledge.feishu.scope.preview') return preview
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('radio', { name: 'Paste a link' }))
    await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not preview this Feishu Wiki URL')
    expect(screen.getByRole('textbox', { name: 'Feishu Wiki URL' })).toHaveValue(url)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Team handbook')).toBeVisible()
  })

  it('closes after creation even when daily scheduling fails and explains the manual fallback', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.scope.preview') return preview
      if (route === 'knowledge.external_source.create') return createdSource
      if (route === 'knowledge.external_source.schedule.update') throw new Error('Schedule failed')
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)

    await reachReview(user)
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    await user.clear(screen.getByLabelText('Daily sync time'))
    await user.type(screen.getByLabelText('Daily sync time'), '10:30')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('source was created')))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.schedule.update', {
      sourceId: createdSource.id,
      policy: expect.objectContaining({ kind: 'daily', time: '10:30' })
    })
    expect(mockRequest.mock.calls.filter(([route]) => route === 'knowledge.external_source.create')).toHaveLength(1)
  })

  it('shows the selected frequency, validates daily time, and preserves it when toggling', async () => {
    const user = userEvent.setup()
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await reachReview(user)

    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeChecked()
    const time = screen.getByLabelText('Daily sync time')
    await user.clear(time)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(time).toBeInvalid()
    await user.type(time, '10:30')
    await user.click(screen.getByRole('radio', { name: 'Manual' }))
    expect(screen.queryByLabelText('Daily sync time')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    expect(screen.getByLabelText('Daily sync time')).toHaveValue('10:30')
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('keeps submitted settings and the wizard stable until creation and scheduling finish', async () => {
    const user = userEvent.setup()
    let finishCreate!: (source: typeof createdSource) => void
    let finishSchedule!: () => void
    const onOpenChange = vi.fn()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.scope.preview') return preview
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.external_source.create')
        return new Promise((resolve) => {
          finishCreate = resolve
        })
      if (route === 'knowledge.external_source.schedule.update')
        return new Promise<void>((resolve) => {
          finishSchedule = resolve
        })
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)
    await reachReview(user)
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('radio', { name: 'Manual' })).toBeDisabled()
    expect(screen.getByLabelText('Daily sync time')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-busy', 'true')
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => finishCreate(createdSource))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.schedule.update', {
        sourceId: createdSource.id,
        policy: expect.objectContaining({ kind: 'daily', time: '09:00' })
      })
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => finishSchedule())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows connection loading and recovery before account selection', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn(async () => undefined)
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: undefined,
      isLoading: false,
      error: new Error('Offline'),
      refetch
    })
    const { rerender } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load Feishu connections')
    await user.click(screen.getByRole('button', { name: 'Retry loading' }))
    expect(refetch).toHaveBeenCalledOnce()

    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: undefined,
      isLoading: true,
      error: undefined,
      refetch
    })
    rerender(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it.each([
    {
      kind: 'generic',
      cause: new Error('raw secret detail'),
      message: 'Could not authorize Feishu. Check the app credentials and permissions, then try again.'
    },
    {
      kind: 'identity',
      cause: new IpcError(knowledgeErrorCodes.FEISHU_IDENTITY_UNVERIFIABLE, 'raw secret detail'),
      message: 'Enable the contact:user.employee_id:readonly permission in your app'
    }
  ])(
    'retains credentials after $kind authorization failure, permits a retry, and cancels the pending session',
    async ({ kind, cause, message }) => {
      const user = userEvent.setup()
      MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
        data: [],
        isLoading: false,
        error: undefined,
        refetch: vi.fn()
      })
      let attempts = 0
      mockRequest.mockImplementation(async (route: string) => {
        if (
          route ===
            (kind === 'identity'
              ? 'knowledge.feishu.authorization.complete'
              : 'knowledge.feishu.authorization.begin') &&
          attempts++ === 0
        )
          throw cause
        if (route === 'knowledge.feishu.authorization.begin') {
          return {
            authorizationSessionId: '55555555-5555-4555-8555-555555555555',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://accounts.feishu.cn/verify',
            connection: { id: 'pending-1' }
          }
        }
        if (route === 'knowledge.feishu.authorization.complete') return await new Promise(() => undefined)
        return undefined
      })
      const onOpenChange = vi.fn()
      const { unmount } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)

      await user.type(screen.getByLabelText('App ID'), 'cli_test')
      await user.type(screen.getByLabelText('App Secret'), 'secret')
      await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('alert')).not.toHaveTextContent('raw secret detail')
      expect(screen.queryByText(/ABCD-EFGH/)).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') })
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('App ID')).toHaveValue('cli_test')
      expect(screen.getByLabelText('App Secret')).toHaveValue('secret')
      expect(screen.getByLabelText('App Secret')).toBeEnabled()
      await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
      expect(
        await screen.findByText(i18n.t('knowledge.external.wizard.verification_code', { code: 'ABCD-EFGH' }))
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('App Secret')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Connect to Feishu' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      unmount()

      await waitFor(() =>
        expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.cancel', {
          authorizationSessionId: '55555555-5555-4555-8555-555555555555'
        })
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockOpenExternal).toHaveBeenCalledWith('https://accounts.feishu.cn/verify')
    }
  )

  it('selects an available whole Wiki space and creates it without inventing a URL', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space, space] }
      if (route === 'knowledge.feishu.space.preview') return spacePreview
      if (route === 'knowledge.external_source.create') return createdSource
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await openWikiOptions(user)
    expect(await screen.findAllByRole('option', { name: /Project Wiki/ })).toHaveLength(1)
    await user.click(screen.getByRole('option', { name: /Project Wiki/ }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Project Wiki')).toBeVisible()
    expect(screen.getByText('Documents to sync: 5')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked()
    expect(screen.queryByLabelText('Daily sync time')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.space.preview', {
      connectionId: connection.id,
      spaceId: space.spaceId
    })
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.create', {
      baseId: 'base-1',
      connectionId: connection.id,
      spaceId: space.spaceId,
      name: 'Project Wiki'
    })
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.external_source.schedule.update', expect.anything())
  })

  it('creates selected Wikis with their original names and a shared sync frequency', async () => {
    const user = userEvent.setup()
    const research = { spaceId: 'space-2', name: 'Research Wiki', description: null }
    const onOpenChange = vi.fn()
    mockRequest.mockImplementation(async (route: string, input?: { spaceId?: string; sourceId?: string }) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space, research] }
      if (route === 'knowledge.feishu.space.preview')
        return input?.spaceId === research.spaceId
          ? {
              ...spacePreview,
              space: research,
              visibleNodeCount: 5,
              supportedDocxCount: 2,
              supportedDocuments: [
                { nodeId: 'research-notes', title: 'Research notes', documentKind: 'document' },
                { nodeId: 'findings', title: 'Study findings', documentKind: 'document' }
              ]
            }
          : spacePreview
      if (route === 'knowledge.external_source.create') return { id: `source-${input?.spaceId}` }
      if (route === 'knowledge.external_source.schedule.update' && input?.sourceId === `source-${research.spaceId}`)
        throw new Error('Schedule failed')
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)
    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await openWikiOptions(user)
    await user.type(screen.getByPlaceholderText('Search'), 'Research')
    expect(screen.queryByRole('option', { name: /Project Wiki/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Research Wiki' }))
    await user.clear(screen.getByPlaceholderText('Search'))
    await user.click(screen.getByRole('option', { name: /Project Wiki/ }))
    expect(screen.getByRole('option', { name: /Project Wiki/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('option', { name: 'Research Wiki' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Project Wiki')).toBeVisible()
    expect(screen.getByText('Research Wiki')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Documents to sync: 5')).toBeVisible()
    expect(screen.getByText('Documents to sync: 2')).toBeVisible()
    const projectPreview = screen.getByRole('region', { name: 'Project Wiki' })
    const researchPreview = screen.getByRole('region', { name: 'Research Wiki' })
    await user.click(within(projectPreview).getByRole('button', { name: /View documents/ }))
    expect(within(projectPreview).getByText('Product roadmap')).toBeVisible()
    expect(within(researchPreview).queryByText('Product roadmap')).not.toBeInTheDocument()
    expect(within(researchPreview).queryByText('Research notes')).not.toBeInTheDocument()
    await user.click(within(researchPreview).getByRole('button', { name: /View documents/ }))
    expect(within(researchPreview).getByText('Research notes')).toBeVisible()
    await user.click(within(projectPreview).getByRole('button', { name: /View reasons/ }))
    const skipped = within(projectPreview).getByRole('region', { name: 'Items to skip: 3 View reasons' })
    expect(within(skipped).getByText('Quarterly metrics')).toBeVisible()
    expect(within(skipped).getByText('Spreadsheet')).toBeVisible()
    expect(within(skipped).getByText('This content type is not supported yet.')).toBeVisible()
    expect(within(skipped).getByText('Reference materials')).toBeVisible()
    expect(within(skipped).getByText('Reference shortcut')).toBeVisible()
    expect(within(skipped).getAllByText('Cross-Wiki shortcut')).toHaveLength(2)
    expect(within(skipped).getAllByText('The linked content belongs to another Wiki.')).toHaveLength(2)
    expect(within(skipped).queryByText('Document')).not.toBeInTheDocument()
    for (const spaceId of [space.spaceId, research.spaceId]) {
      expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.space.preview', {
        connectionId: connection.id,
        spaceId
      })
    }
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    await user.clear(screen.getByLabelText('Daily sync time'))
    await user.type(screen.getByLabelText('Daily sync time'), '10:30')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toast.error).toHaveBeenCalledWith({
      title: i18n.t('knowledge.external.wizard.daily_warning'),
      description: 'Research Wiki'
    })
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.create', {
      baseId: 'base-1',
      connectionId: connection.id,
      spaceId: space.spaceId,
      name: 'Project Wiki'
    })
    expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.create', {
      baseId: 'base-1',
      connectionId: connection.id,
      spaceId: research.spaceId,
      name: 'Research Wiki'
    })
    for (const spaceId of [space.spaceId, research.spaceId]) {
      expect(mockRequest).toHaveBeenCalledWith('knowledge.external_source.schedule.update', {
        sourceId: `source-${spaceId}`,
        policy: expect.objectContaining({ kind: 'daily', time: '10:30' })
      })
    }
  })

  it('retains partial creation progress, locks the saved plan, and retries only the failed Wiki', async () => {
    const user = userEvent.setup()
    const research = { spaceId: 'space-2', name: 'Research Wiki', description: null }
    const operations = { spaceId: 'space-3', name: 'Operations Wiki', description: null }
    const spaces = [space, research, operations]
    const onOpenChange = vi.fn()
    let researchAttempts = 0
    mockRequest.mockImplementation(async (route: string, input?: { spaceId?: string }) => {
      if (route === 'knowledge.feishu.spaces.list') return { spaces }
      if (route === 'knowledge.feishu.space.preview')
        return { ...spacePreview, space: spaces.find((item) => item.spaceId === input?.spaceId) }
      if (route === 'knowledge.external_source.create') {
        if (input?.spaceId === research.spaceId && researchAttempts++ < 2) throw new Error('Temporary provider failure')
        return { id: `source-${input?.spaceId}` }
      }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={onOpenChange} />)
    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await openWikiOptions(user)
    await user.click(await screen.findByRole('option', { name: /Project Wiki/ }))
    await user.click(screen.getByRole('option', { name: 'Research Wiki' }))
    await user.click(screen.getByRole('option', { name: 'Operations Wiki' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('button', { name: 'Add' })
    await user.click(screen.getByRole('radio', { name: 'Daily' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some sources could not be created. Retry to create the remaining sources.'
    )
    expect(screen.getByText('Created 2 of 3 sources.')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Research Wiki')
    expect(screen.getByRole('radio', { name: 'Manual' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Daily' })).toBeDisabled()
    expect(screen.getByLabelText('Daily sync time')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Research Wiki')
    expect(screen.getByText('Created 2 of 3 sources.')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const creates = mockRequest.mock.calls.filter(([route]) => route === 'knowledge.external_source.create')
    expect(creates.filter(([, input]) => input.spaceId === space.spaceId)).toHaveLength(1)
    expect(creates.filter(([, input]) => input.spaceId === research.spaceId)).toHaveLength(3)
    expect(creates.filter(([, input]) => input.spaceId === operations.spaceId)).toHaveLength(1)
    const schedules = mockRequest.mock.calls.filter(([route]) => route === 'knowledge.external_source.schedule.update')
    expect(schedules.filter(([, input]) => input.sourceId === `source-${space.spaceId}`)).toHaveLength(1)
    expect(schedules.filter(([, input]) => input.sourceId === `source-${research.spaceId}`)).toHaveLength(1)
    expect(schedules.filter(([, input]) => input.sourceId === `source-${operations.spaceId}`)).toHaveLength(1)
  })

  it('loads another page and lets the user choose a space from it', async () => {
    const user = userEvent.setup()
    const laterSpace = { spaceId: 'space-2', name: 'Research Wiki', description: null }
    mockRequest.mockImplementation(async (route: string, input?: { pageToken?: string }) => {
      if (route === 'knowledge.feishu.spaces.list') {
        return input?.pageToken ? { spaces: [space, laterSpace] } : { spaces: [space], nextPageToken: 'page-2' }
      }
      if (route === 'knowledge.feishu.space.preview') return { ...spacePreview, space: laterSpace }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Load more Wikis' }))
    await openWikiOptions(user)
    expect(screen.getAllByRole('option', { name: /Project Wiki/ })).toHaveLength(1)
    await user.click(screen.getByRole('option', { name: 'Research Wiki' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Research Wiki')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await openWikiOptions(user)
    expect(screen.getByRole('option', { name: 'Research Wiki' })).toHaveAttribute('aria-checked', 'true')
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.spaces.list', {
      connectionId: connection.id,
      pageToken: 'page-2'
    })
  })

  it('keeps pagination available when an accessible-space page is empty', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string, input?: { pageToken?: string }) => {
      if (route === 'knowledge.feishu.spaces.list') {
        return input?.pageToken ? { spaces: [space] } : { spaces: [], nextPageToken: 'page-2' }
      }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('button', { name: 'Load more Wikis' })
    expect(screen.queryByText(/No Wikis are available/)).not.toBeInTheDocument()
    expect(screen.queryByText('Available Feishu Wikis')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more Wikis' }))

    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
  })

  it('ignores a late space page from a previously selected account', async () => {
    const user = userEvent.setup()
    const otherConnection = { ...connection, id: '0199c87a-1200-7000-8000-000000000003', displayName: 'Bob' }
    const otherSpace = { spaceId: 'space-2', name: 'Bob Wiki', description: null }
    let resolveAlice: (page: { spaces: (typeof space)[] }) => void = () => undefined
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', {
      data: [connection, otherConnection],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockRequest.mockImplementation(async (route: string, input?: { connectionId?: string }) => {
      if (route !== 'knowledge.feishu.spaces.list') return undefined
      if (input?.connectionId === connection.id) {
        return await new Promise((resolve) => {
          resolveAlice = resolve
        })
      }
      return { spaces: [otherSpace] }
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await selectApplication(user, /Team Wiki.*Bob/)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await openWikiOptions(user)
    expect(await screen.findByRole('option', { name: 'Bob Wiki' })).toBeVisible()

    await act(async () => resolveAlice({ spaces: [space] }))
    expect(screen.queryByRole('option', { name: /Project Wiki/ })).not.toBeInTheDocument()
  })

  it('explains missing space-list permission and preserves the URL path', async () => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list') {
        throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Permission missing')
      }
      if (route === 'knowledge.feishu.scope.preview') return preview
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission is required to load the Wiki list')
    expect(screen.queryByText('Available Feishu Wikis')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Paste a link' }))
    await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Team handbook')).toBeVisible()
  })

  it('reauthorizes space discovery only after the user requests it and reloads spaces', async () => {
    const user = userEvent.setup()
    let listAttempts = 0
    let finishAuthorization!: (value: typeof connection) => void
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list' && listAttempts++ === 0) {
        throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Permission missing')
      }
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      if (route === 'knowledge.feishu.connection.reconnect') {
        return {
          authorizationSessionId: '55555555-5555-4555-8555-555555555555',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://accounts.feishu.cn/verify'
        }
      }
      if (route === 'knowledge.feishu.authorization.complete') {
        return new Promise((resolve) => {
          finishAuthorization = resolve
        })
      }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission is required to load the Wiki list')
    expect(screen.queryByText('Available Feishu Wikis')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/pauses sync for sources using this connection/)).toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.connection.reconnect', expect.anything())
    await user.click(screen.getByRole('button', { name: 'Authorize Wiki listing' }))

    expect(
      await screen.findByText(i18n.t('knowledge.external.wizard.verification_code', { code: 'ABCD-EFGH' }))
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.open_authorization_page') })
    ).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Add Feishu Wiki' })).toBeVisible()
    expect(screen.getByRole('status').textContent).toBe(i18n.t('knowledge.external.wizard.authorizing'))
    expect(screen.getByRole('img', { name: i18n.t('knowledge.external.wizard.authorization_help') })).toBeVisible()
    expect(screen.queryByRole('radio', { name: 'Choose Wikis' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Paste a link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Authorize Wiki listing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await act(async () => finishAuthorization(connection))
    expect(screen.queryByText(/ABCD-EFGH/)).not.toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.connection.reconnect', {
      connectionId: connection.id,
      includeSpaceDiscovery: true
    })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://accounts.feishu.cn/verify')
  })

  it('retries a failed space list and recovers the selection', async () => {
    const user = userEvent.setup()
    let listAttempts = 0
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list' && listAttempts++ === 0) throw new Error('Offline')
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the Wiki list')
    expect(screen.queryByText('Available Feishu Wikis')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry loading' }))

    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
  })

  it('requests Wiki discovery by default and advances custom authorization to the Wiki list', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin') return authorizationStart
      if (route === 'knowledge.feishu.authorization.complete') return connection
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)

    await user.type(screen.getByLabelText('App ID'), 'cli_test')
    await user.type(screen.getByLabelText('App Secret'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))

    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Choose Wikis' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Paste a link' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'custom-app',
      appId: 'cli_test',
      appSecret: 'secret',
      includeSpaceDiscovery: true
    })
  })

  it('connects with a link only after explicit permission fallback and resets the default when selecting another account', async () => {
    const user = userEvent.setup()
    const otherConnection = { ...connection, id: '0199c87a-1200-7000-8000-000000000003', displayName: 'Bob' }
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
    mockRequest.mockImplementation(async (route: string, input?: { includeSpaceDiscovery?: boolean }) => {
      if (route === 'knowledge.feishu.authorization.begin') {
        if (input?.includeSpaceDiscovery !== false)
          throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Missing discovery')
        return authorizationStart
      }
      if (route === 'knowledge.feishu.authorization.complete') return connection
      if (route === 'knowledge.feishu.spaces.list') return { spaces: [space] }
      return undefined
    })
    const { rerender } = render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await user.type(screen.getByLabelText('App ID'), 'cli_test')
    await user.type(screen.getByLabelText('App Secret'), 'secret')
    expect(screen.queryByRole('button', { name: 'Continue with a link only' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('missing required permissions')
    expect(screen.getByLabelText('App ID')).toHaveValue('cli_test')
    expect(screen.getByLabelText('App Secret')).toHaveValue('secret')
    expect(mockRequest.mock.calls.filter(([route]) => route === 'knowledge.feishu.authorization.begin')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Continue with a link only' }))

    expect(await screen.findByRole('textbox', { name: 'Feishu Wiki URL' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Paste a link' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Choose Wikis' })).toBeEnabled()
    expect(mockRequest).toHaveBeenCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'custom-app',
      appId: 'cli_test',
      appSecret: 'secret',
      includeSpaceDiscovery: false
    })
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.spaces.list', expect.anything())

    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [connection, otherConnection] })
    rerender(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await selectApplication(user, /Team Wiki.*Bob/)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('combobox', { name: 'Available Feishu Wikis' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Choose Wikis' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('keeps a failed link-only attempt on the credentials form and retains its explicit mode until credentials change', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryResult('/external-knowledge-connections', { data: [] })
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.authorization.begin')
        throw new IpcError(knowledgeErrorCodes.FEISHU_SCOPE_MISSING, 'Missing base scope')
      if (route === 'knowledge.feishu.registration.begin')
        throw new IpcError(knowledgeErrorCodes.FEISHU_REGISTRATION_FAILED, 'Failed')
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await user.type(screen.getByLabelText('App ID'), 'cli_test')
    await user.type(screen.getByLabelText('App Secret'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
    await user.click(await screen.findByRole('button', { name: 'Continue with a link only' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('missing required permissions')
    expect(screen.getByLabelText('App Secret')).toHaveValue('secret')
    expect(screen.queryByRole('radio', { name: 'Paste a link' })).not.toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalledWith('knowledge.feishu.authorization.complete', expect.anything())
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
    expect(mockRequest).toHaveBeenLastCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'custom-app',
      appId: 'cli_test',
      appSecret: 'secret',
      includeSpaceDiscovery: false
    })

    await user.type(screen.getByLabelText('App Secret'), '-new')
    expect(screen.queryByRole('button', { name: 'Continue with a link only' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
    expect(mockRequest).toHaveBeenLastCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'custom-app',
      appId: 'cli_test',
      appSecret: 'secret-new',
      includeSpaceDiscovery: true
    })
    await user.click(await screen.findByRole('button', { name: 'Continue with a link only' }))
    await user.click(screen.getByRole('button', { name: i18n.t('knowledge.external.wizard.create_app') }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Connect to Feishu' }))
    expect(mockRequest).toHaveBeenLastCalledWith('knowledge.feishu.authorization.begin', {
      kind: 'custom-app',
      appId: 'cli_test',
      appSecret: 'secret-new',
      includeSpaceDiscovery: true
    })
  })

  it('retains the chosen Wiki and pasted link when switching scope tabs', async () => {
    const user = userEvent.setup()
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await selectWiki(user, /Project Wiki/)
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    await user.click(screen.getByRole('radio', { name: 'Paste a link' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
    await user.click(screen.getByRole('radio', { name: 'Choose Wikis' }))
    await openWikiOptions(user)
    expect(screen.getByRole('option', { name: /Project Wiki/ })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    await user.click(screen.getByRole('radio', { name: 'Paste a link' }))
    expect(screen.getByRole('textbox', { name: 'Feishu Wiki URL' })).toHaveValue(url)
  })

  it.each(['loading', 'empty'])('keeps the link path available when the Wiki list is %s', async (state) => {
    const user = userEvent.setup()
    mockRequest.mockImplementation(async (route: string) => {
      if (route === 'knowledge.feishu.spaces.list')
        return state === 'loading' ? new Promise(() => undefined) : { spaces: [] }
      if (route === 'knowledge.feishu.scope.preview') return preview
      return undefined
    })
    render(<FeishuWikiWizard open baseId="base-1" onOpenChange={vi.fn()} />)
    await selectApplication(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    if (state === 'loading') expect(await screen.findByRole('status')).toHaveTextContent('Loading')
    else
      expect(
        await screen.findByText('No Wikis are available. You can paste a document or Wiki link instead.')
      ).toBeVisible()
    expect(screen.queryByText('Available Feishu Wikis')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Choose Wikis' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Paste a link' }))
    await user.type(screen.getByRole('textbox', { name: 'Feishu Wiki URL' }), url)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Team handbook')).toBeVisible()
  })
})
